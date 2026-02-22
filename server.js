const appInsights = require("applicationinsights");

// Initialize Application Insights before anything else
if (process.env.APPINSIGHTS_CONNECTION_STRING) {
  appInsights
    .setup(process.env.APPINSIGHTS_CONNECTION_STRING)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .start();

  // Tag telemetry with service name and deployment SHA
  appInsights.defaultClient.context.tags[
    appInsights.defaultClient.context.keys.cloudRole
  ] = "api-gateway";

  if (process.env.DEPLOY_SHA) {
    appInsights.defaultClient.commonProperties = {
      deploySha: process.env.DEPLOY_SHA,
    };
  }
}

const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Orders endpoint — healthy: ~0.1% error rate
app.get("/api/orders", (req, res) => {
  if (Math.random() < 0.001) {
    return res.status(500).json({ error: "internal server error" });
  }
  res.json({
    orders: [
      { id: 1, item: "Widget A", qty: 10, total: 99.9 },
      { id: 2, item: "Widget B", qty: 5, total: 49.95 },
      { id: 3, item: "Gadget C", qty: 2, total: 199.98 },
    ],
  });
});

// Payments endpoint — healthy: ~150ms P95
app.post("/api/payments", async (req, res) => {
  // Simulate normal processing time (50-150ms)
  const delay = 50 + Math.random() * 100;
  await new Promise((r) => setTimeout(r, delay));
  res.json({
    paymentId: `pay_${Date.now()}`,
    status: "processed",
    amount: req.body?.amount || 0,
  });
});

app.listen(PORT, () => {
  console.log(`deploy-health-demo listening on port ${PORT}`);
});
