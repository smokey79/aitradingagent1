# LangGraph prediction workflow

The Node orchestrator runs a small LangGraph with two nodes: forecast plus context, then a shadow safety boundary. It calls the existing BTC next-candle predictor, including BTC/gold/FX rolling correlations and the paper-outcome contextual bandit. The graph has no order tool and the result is not passed to consensus, the risk gate, or exchange execution.

Dependencies are declared in the root `package.json` (`@langchain/langgraph`, `@langchain/core`). This project uses CommonJS; the graph module uses Node's dynamic `import()` for LangGraph.

The graph is configured in `agents/langgraph/predictionGraph.js`. Its terminal state explicitly sets `executionAllowed: false`. Treat this as research output only.
