# LangGraph shadow research workflow

The graph has forecast/context and shadow-boundary nodes. Its input includes the shared immutable research snapshot; the predictor reuses its closed OHLCV bars rather than fetching history again. All output remains advisory. The guard metadata records executionAllowed=false; the stronger boundary is that the research scheduler does not import any order execution module.

The scheduler first captures and archives one snapshot, then applies a cheap fail-closed filter. Only eligible snapshots reach LangGraph and the AI consensus. Each price agent receives the same compact price/order-book facts and snapshot ID.

Dependencies are declared in package.json. CommonJS modules use dynamic import for LangGraph. No LangGraph service, Node scheduler or Freqtrade instance was started here.
