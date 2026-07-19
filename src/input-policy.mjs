const forbiddenImageFields = new Set([
  "base64",
  "bytes",
  "data_url",
  "image",
  "image_base64",
  "image_bytes",
  "image_data",
  "raw_image"
]);

export class InputPolicyError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = "InputPolicyError";
    this.code = code;
    this.status = status;
  }
}

export function enforceAnalysisInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InputPolicyError("invalid_input", "The analysis request must be a JSON object.", 400);
  }
  rejectRawImageFields(input);
  if (!input.features || typeof input.features !== "object" || Array.isArray(input.features)) {
    throw new InputPolicyError("missing_features", "Aggregate visual features are required.");
  }
  if (input.filename !== undefined && (typeof input.filename !== "string" || input.filename.length > 255)) {
    throw new InputPolicyError("invalid_filename", "filename must be a string no longer than 255 characters.");
  }
  if (input.image_sha256 !== undefined && input.image_sha256 !== "" && !/^[a-f0-9]{64}$/i.test(String(input.image_sha256))) {
    throw new InputPolicyError("invalid_image_digest", "image_sha256 must be a 64-character hexadecimal SHA-256 digest.");
  }
  if (input.size !== undefined && (!Number.isFinite(Number(input.size)) || Number(input.size) < 0 || Number(input.size) > 25_000_000)) {
    throw new InputPolicyError("invalid_image_size", "size must be between 0 and 25,000,000 bytes.");
  }
  return input;
}

function rejectRawImageFields(value, path = "request") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenImageFields.has(key.toLowerCase())) {
      throw new InputPolicyError("raw_image_forbidden", `Raw image material is forbidden at ${path}.${key}.`);
    }
    if (nested && typeof nested === "object") rejectRawImageFields(nested, `${path}.${key}`);
  }
}
