const healthyWords = ["salad", "avocado", "broccoli", "vegetable", "fruit", "apple", "banana", "berry", "berries", "spinach", "grain", "salmon"];
const treatWords = ["donut", "doughnut", "burger", "fries", "pizza", "cake", "soda", "candy", "cookie", "fried"];

export function analyzeFoodImage(input) {
  const features = normalizeFeatures(input?.features);
  const filename = String(input?.filename || "food-image").toLowerCase();
  const positive = healthyWords.filter((word) => filename.includes(word));
  const negative = treatWords.filter((word) => filename.includes(word));
  const [red, green, blue] = features.average_rgb;
  const greenSignal = (green - (red + blue) / 2) / 255;
  const warmSignal = (red - blue) / 255;

  let score = 50;
  score += positive.length ? 28 : 0;
  score -= negative.length ? 28 : 0;
  score += greenSignal * 25;
  score -= Math.max(0, warmSignal - 0.35) * 12;
  score += features.colorfulness >= 35 && features.colorfulness <= 105 ? 5 : 0;
  score += features.brightness >= 65 && features.brightness <= 225 ? 4 : -4;
  score += features.edge_density >= 0.04 ? 3 : 0;
  score = clamp(Math.round(score), 5, 95);

  const classification = score >= 68 ? "healthy" : score >= 43 ? "mixed" : "less_healthy";
  const confidence = clamp(Math.round(62 + Math.abs(score - 50) * 0.58 + (positive.length || negative.length ? 10 : 0)), 62, 96);
  const detected = positive.length ? positive : negative.length ? negative : inferredItems(features);
  const signals = buildSignals({ classification, features, positive, negative, greenSignal });

  return {
    classification,
    score,
    confidence,
    detected_items: [...new Set(detected)].slice(0, 4),
    summary: summaryFor(classification),
    signals,
    evidence: {
      model: "food-lens-demo-v0.1",
      image_sha256: String(input?.image_sha256 || ""),
      mime_type: String(input?.mime_type || "unknown"),
      image_bytes: Number(input?.size || 0),
      visual_features: features,
      filename_hints: [...positive, ...negative],
      method: "deterministic demo classifier"
    },
    disclaimer: "Educational demo only. This is not medical or nutritional advice, and it does not identify ingredients or allergens reliably."
  };
}

function normalizeFeatures(value = {}) {
  const rgb = Array.isArray(value.average_rgb) && value.average_rgb.length === 3 ? value.average_rgb : [128, 128, 128];
  return {
    average_rgb: rgb.map((item) => clamp(Number(item) || 0, 0, 255)),
    brightness: clamp(Number(value.brightness) || 128, 0, 255),
    colorfulness: clamp(Number(value.colorfulness) || 0, 0, 255),
    edge_density: clamp(Number(value.edge_density) || 0, 0, 1)
  };
}

function inferredItems(features) {
  const [red, green, blue] = features.average_rgb;
  if (green > red * 1.12 && green > blue * 1.12) return ["leafy produce"];
  if (red > green * 1.18 && red > blue * 1.25) return ["warm-colored food"];
  if (red > 170 && green > 135 && blue < 120) return ["grain or baked food"];
  return ["unidentified meal"];
}

function buildSignals({ classification, features, positive, negative, greenSignal }) {
  const values = [];
  if (positive.length) values.push({ label: "Whole-food cue", value: positive.join(", "), impact: "positive" });
  if (negative.length) values.push({ label: "Treat-food cue", value: negative.join(", "), impact: "negative" });
  values.push({ label: "Produce color signal", value: greenSignal > 0.08 ? "strong" : greenSignal > -0.04 ? "moderate" : "low", impact: greenSignal > 0.08 ? "positive" : "neutral" });
  values.push({ label: "Visual variety", value: features.colorfulness > 55 ? "high" : features.colorfulness > 25 ? "moderate" : "low", impact: features.colorfulness > 35 ? "positive" : "neutral" });
  values.push({ label: "Model conclusion", value: classification.replace("_", " "), impact: classification === "healthy" ? "positive" : classification === "less_healthy" ? "negative" : "neutral" });
  return values;
}

function summaryFor(classification) {
  if (classification === "healthy") return "This image has visual cues commonly associated with a balanced, whole-food meal.";
  if (classification === "less_healthy") return "This image has cues commonly associated with a discretionary or highly processed food.";
  return "The image contains mixed or uncertain cues; treat the score as a prompt for closer review.";
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
