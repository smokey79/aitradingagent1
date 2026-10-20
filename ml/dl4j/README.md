# DL4J at Layer 3

Upstream repository: https://github.com/deeplearning4j/deeplearning4j
This module depends on the official Maven artifacts; it does not vendor or fork the upstream source.
The upstream README documents the 1.0.0-M2.1 dependency line used here.

| Layer | Implementation and boundary |
| --- | --- |
| 1 Data collection | CCXT Bitget closed candles/book and optional shared CMC/CoinGecko feeds |
| 2 Feature engineering | Immutable versioned snapshots; 12 closed-OHLCV features from featureAt |
| 3 ML prediction | Existing logistic benchmark plus local DL4J MultiLayerNetwork inference |
| 4 Agent analysis | Identical compact snapshot including both ML reports for all four agents |
| 5 Consensus | Advisory weighted agreement; DL4J scores are not calibrated win probabilities |
| 6 Risk engine | Freqtrade baseline position/stop/spot limits; AI results do not authorize entries |
| 7 Execution | Freqtrade dry-run only; no Node-to-order bridge is enabled |

## Inference service

Source: src/main/java/trading/dl4j/InferenceServer.java.
Requires Maven, Java 17 and the native CPU ND4J backend. Main class is trading.dl4j.InferenceServer.
It binds only to 127.0.0.1:8766 with GET /health and POST /predict.
The first main argument is the artifact directory; default is models relative to the service working directory.

Dependencies are pinned in pom.xml. nd4j-native-platform is CPU based but downloads native libraries for several platforms; its disk/memory footprint must be checked on the laptop. There is no CUDA requirement. Build/import/native-backend compatibility has not been tested here. Before starting on the Ryzen laptop, set a bounded JVM heap and OMP_NUM_THREADS/OPENBLAS_NUM_THREADS to 2. The executor serializes requests; ND4J numerical kernels still require their own thread limits.

Node's adapter calls only the local endpoint with a two-second timeout. DL4J_ENABLED=false disables the call; otherwise the adapter attempts the local service once per accepted research cycle. A missing service returns unavailable, and a service with no valid artifact returns model_not_ready. No process is started by the adapter.

## Trained artifact contract

Provide models/model.zip saved with DL4J ModelSerializer and models/manifest.json conforming to manifest.schema.json. The network must take a rank-2 row with 12 features and produce a two-column softmax in [down, up] order. The model file SHA-256 must match the manifest. means and scales are the scaler fitted only to training observations, in the feature order exported as FEATURE_NAMES from agents/prediction/dl4jPredictor.js.

The target is whether the next completed 15-minute close exceeds the current completed close. trainedThroughMs means the latest availability time of any training LABEL, not merely the opening time of the last training feature. It must strictly precede the inference asOfMs. Do not train on incomplete bars, fit a scaler on a test period, or reuse holdouts for model selection.

The feature contract is dl4j-ohlcv12-v1 and deliberately excludes aggregator/social inputs. A different feature set requires a new version and newly trained artifacts. The service validates schema identity, pair/timeframe, timestamps, scaler, finite inputs and softmax outputs. It normalizes once using the manifest scaler. It does not fit, initialize a random fallback network, fetch market data, or edit a model at runtime.

No trained model, scaler or measured DL4J accuracy has been supplied. Therefore this is an inference integration awaiting a trained artifact, not an operational deep-learning predictor. An inference-ready artifact is not evidence of edge: require chronological walk-forward, calibration/cost comparisons against the existing predictor and price-only Freqtrade baseline, followed by paper outcomes.

## Snapshot audit

LangGraph runs DL4J after the statistical predictor and before agent analysis. The complete ML report is attached to a newly hashed snapshot, preserving the parent snapshot identity used for inference. All agents receive the same final snapshot ID and ML reports. Model version/digest, feature version, input snapshot ID and training cutoff are recorded with accepted scores. The registry records this challenger as awaiting_trained_artifact; automatic promotion remains off.

## Verification and operating state

JavaScript contract tests use synthetic candles and mocked inference responses. Java compilation, Maven dependency resolution, native backend loading and real model inference have not been run. No terminal, service, training job or deployment was launched.
