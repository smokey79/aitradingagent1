/**
 * LangGraph shadow pipeline for next-candle research.
 * No node has access to exchange order methods or the risk-gate execution path.
 */
const { predictNextCandle } = require('../prediction/nextCandlePredictor');

let compiledGraph;

async function buildGraph() {
  if (compiledGraph) return compiledGraph;
  const { Annotation, StateGraph, START, END } = await import('@langchain/langgraph');
  const State = Annotation.Root({
    pair: Annotation(),
    snapshot: Annotation(),
    report: Annotation(),
    safety: Annotation(),
  });

  compiledGraph = new StateGraph(State)
    .addNode('forecast_and_context', async ({ pair, snapshot }) => ({
      report: await predictNextCandle(pair, { loaded: snapshot && snapshot.candles }),
    }))
    .addNode('shadow_boundary', async ({ report }) => ({
      safety: {
        advisoryOnly: true,
        executionAllowed: false,
        pipeline: 'langgraph_shadow',
        status: report && report.status ? report.status : 'unavailable',
      },
    }))
    .addEdge(START, 'forecast_and_context')
    .addEdge('forecast_and_context', 'shadow_boundary')
    .addEdge('shadow_boundary', END)
    .compile();

  return compiledGraph;
}

async function runPredictionGraph(pair, snapshot) {
  const graph = await buildGraph();
  const result = await graph.invoke({ pair, snapshot });
  return { ...result.report, pipeline: result.safety };
}

module.exports = { runPredictionGraph };
