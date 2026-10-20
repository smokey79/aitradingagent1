package trading.dl4j;

import com.google.gson.*;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.deeplearning4j.nn.multilayer.MultiLayerNetwork;
import org.deeplearning4j.util.ModelSerializer;
import org.nd4j.linalg.api.ndarray.INDArray;
import org.nd4j.linalg.factory.Nd4j;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;

/** CPU inference only. Requires trained model.zip plus its scaler/metadata manifest. */
public final class InferenceServer {
    private static final Gson JSON = new Gson();
    private static final String VERSION = "dl4j-ohlcv12-v1";
    private static MultiLayerNetwork model;
    private static String modelId, modelHash;
    private static long trainedThrough;
    private static double[] means, scales;

    private static String sha256(Path path) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (var stream = Files.newInputStream(path)) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = stream.read(buffer)) != -1) md.update(buffer, 0, n);
        }
        return HexFormat.of().formatHex(md.digest());
    }

    private static void loadModel(Path directory) throws Exception {
        JsonObject manifest = JsonParser.parseString(
            Files.readString(directory.resolve("manifest.json"))).getAsJsonObject();
        if (!VERSION.equals(manifest.get("featureVersion").getAsString()) ||
            !"BTC/USDT".equals(manifest.get("pair").getAsString()) ||
            !"15m".equals(manifest.get("timeframe").getAsString()))
            throw new IllegalArgumentException("Model contract mismatch");
        JsonArray labels = manifest.getAsJsonArray("labels");
        if (labels.size() != 2 || !"down".equals(labels.get(0).getAsString()) ||
            !"up".equals(labels.get(1).getAsString())) throw new IllegalArgumentException("Labels mismatch");
        modelId = manifest.get("modelId").getAsString();
        trainedThrough = manifest.get("trainedThroughMs").getAsLong();
        if (modelId.isBlank() || modelId.length() > 128 || trainedThrough <= 0)
            throw new IllegalArgumentException("Invalid model metadata");
        means = JSON.fromJson(manifest.get("means"), double[].class);
        scales = JSON.fromJson(manifest.get("scales"), double[].class);
        if (means.length != 12 || scales.length != 12) throw new IllegalArgumentException("Scaler shape");
        for (int i = 0; i < 12; i++)
            if (!Double.isFinite(means[i]) || !Double.isFinite(scales[i]) || scales[i] <= 0)
                throw new IllegalArgumentException("Invalid scaler");
        Path file = directory.resolve("model.zip");
        modelHash = sha256(file);
        if (!modelHash.equals(manifest.get("modelSha256").getAsString()))
            throw new IllegalArgumentException("Model digest mismatch");
        model = ModelSerializer.restoreMultiLayerNetwork(file.toFile(), false);
    }

    private static void reply(HttpExchange exchange, int code, Object body) throws java.io.IOException {
        byte[] bytes = JSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(code, bytes.length);
        try (var output = exchange.getResponseBody()) { output.write(bytes); }
    }

    private static void predict(HttpExchange exchange) throws java.io.IOException {
        try {
            if (!"POST".equals(exchange.getRequestMethod())) {
                reply(exchange, 405, Map.of("status", "method_not_allowed")); return;
            }
            if (model == null) { reply(exchange, 503, Map.of("status", "model_not_ready")); return; }
            byte[] body = exchange.getRequestBody().readNBytes(32769);
            if (body.length > 32768) { reply(exchange, 413, Map.of("status", "request_too_large")); return; }
            JsonObject input = JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
            long asOf = input.get("asOfMs").getAsLong();
            long age = System.currentTimeMillis() - asOf;
            if (input.get("schemaVersion").getAsInt() != 1 ||
                !VERSION.equals(input.get("featureVersion").getAsString()) ||
                !"BTC/USDT".equals(input.get("pair").getAsString()) ||
                !"15m".equals(input.get("timeframe").getAsString()) ||
                trainedThrough >= asOf || age < 0 || age > 120000)
                throw new IllegalArgumentException("Input contract or timestamp mismatch");
            String snapshotId = input.get("snapshotId").getAsString();
            if (!snapshotId.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Snapshot identifier");
            double[] raw = JSON.fromJson(input.get("features"), double[].class);
            if (raw.length != 12) throw new IllegalArgumentException("Input shape");
            double[][] scaled = new double[1][12];
            for (int i = 0; i < 12; i++) {
                if (!Double.isFinite(raw[i])) throw new IllegalArgumentException("Nonfinite input");
                scaled[0][i] = (raw[i] - means[i]) / scales[i];
                if (!Double.isFinite(scaled[0][i])) throw new IllegalArgumentException("Invalid normalization");
            }
            try (INDArray features = Nd4j.create(scaled); INDArray result = model.output(features, false)) {
                if (result.rank() != 2 || result.size(0) != 1 || result.size(1) != 2)
                    throw new IllegalArgumentException("Output must be [down,up] softmax");
                double down = result.getDouble(0, 0), up = result.getDouble(0, 1);
                if (!Double.isFinite(up) || !Double.isFinite(down) || up < 0 || up > 1 ||
                    down < 0 || down > 1 || Math.abs(up + down - 1) > 0.00001)
                    throw new IllegalArgumentException("Invalid softmax scores");
                reply(exchange, 200, Map.of("status", "shadow_only", "snapshotId", snapshotId,
                    "featureVersion", VERSION, "asOfMs", asOf, "modelId", modelId,
                    "modelSha256", modelHash, "trainedThroughMs", trainedThrough, "scoreUp", up));
            }
        } catch (Exception error) { reply(exchange, 422, Map.of("status", "prediction_rejected")); }
        finally { exchange.close(); }
    }

    public static void main(String[] args) throws Exception {
        try { loadModel(Path.of(args.length > 0 ? args[0] : "models")); }
        catch (Exception error) {
            model = null;
            System.err.println("DL4J model not ready. Supply a validated model.zip and manifest.json.");
        }
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 8766), 8);
        server.createContext("/health", exchange -> {
            reply(exchange, model == null ? 503 : 200,
                Map.of("status", model == null ? "model_not_ready" : "ready", "featureVersion", VERSION));
            exchange.close();
        });
        server.createContext("/predict", InferenceServer::predict);
        server.setExecutor(Executors.newSingleThreadExecutor());
        server.start();
    }
}
