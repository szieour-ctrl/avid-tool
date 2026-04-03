const Anthropic = require("@anthropic-ai/sdk");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PAGE_H = 792;
const FS = 8.5;
const LS = 11.5;

function rl(structY, nudge = 3) {
  return PAGE_H - structY + nudge;
}

function wrap(text, maxChars = 86) {
  if (!text) return [];
  text = text.trim();
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length <= maxChars) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function getVal(d, key) {
  if (!d) return "";
  const v = d[key];
  if (typeof v === "object" && v !== null) return (v.text || "").trim();
  return (v || "").trim();
}

function decryptPdf(pdfBytes) {
  const tmpDir = os.tmpdir();
  const inPath  = path.join(tmpDir, `avid_in_${Date.now()}.pdf`);
  const outPath = path.join(tmpDir, `avid_out_${Date.now()}.pdf`);
  try {
    fs.writeFileSync(inPath, pdfBytes);
    execSync(`qpdf --password="" --decrypt "${inPath}" "${outPath}"`, { timeout: 15000 });
    const decrypted = fs.readFileSync(outPath);
    return decrypted;
  } catch (e) {
    console.error("qpdf error:", e.message);
    return pdfBytes;
  } finally {
    try { fs.unlinkSync(inPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}
  }
}

function buildFields(data) {
  const h = data.header || {};
  const i = data.interior || {};
  const ex = data.exterior || {};
  const fields = [];

  function place(page, x, lineY, text, mc = 86, ml = 2, fs = FS) {
    const lines = wrap(text, mc).slice(0, ml);
    lines.forEach((ln, idx) => {
      fields.push({ page, x, y: rl(lineY) - idx * LS, text: ln, fs });
    });
  }

  place(2, 188, 94.6,  getVal(i, "entry"),       76, 2);
  place(2, 108, 137.1, getVal(i, "living_room"),  86, 2);
  place(2, 108, 179.6, getVal(i, "dining_room"),  86, 2);
  place(2, 108, 222.1, getVal(i, "kitchen"),      86, 2);
  place(2, 108, 264.6, getVal(i, "other_room"),   86, 2);
  place(2, 220, 307.1, getVal(i, "hall_stairs"),  66, 2);

  const bedMap = [["bedroom_1",349.6],["bedroom_2",392.1],["bedroom_3",434.6],["bedroom_4",477.1]];
  bedMap.forEach(([key, ly], idx) => {
    fields.push({ page: 2, x: 91, y: rl(ly), text: String(idx + 1), fs: 8.5 });
    place(2, 108, ly, getVal(i, key), 86, 2);
  });

  const bathMap = [["bath_1",519.6],["bath_2",562.1],["bath_3",604.6],["bath_4",647.1]];
  bathMap.forEach(([key, ly], idx) => {
    fields.push({ page: 2, x: 68, y: rl(ly), text: String(idx + 1), fs: 8.5 });
    place(2, 108, ly, getVal(i, key), 86, 2);
  });

  place(3, 246, 198.6, getVal(ex, "garage_parking"), 60, 2);

  const extText = getVal(ex, "exterior_building_yard");
  const extLines = wrap(extText, 56);
  if (extLines[0]) fields.push({ page: 3, x: 259, y: rl(250.6), text: extLines[0], fs: FS });
  if (extLines.length > 1) place(3, 108, 262.6, extLines.slice(1).join(" "), 86, 2);

  const othText = getVal(ex, "other_conditions");
  const othLines = wrap(othText, 40);
  if (othLines[0]) fields.push({ page: 3, x: 342, y: rl(302.6), text: othLines[0], fs: FS });
  if (othLines.length > 1) place(3, 108, 314.6, othLines.slice(1).join(" "), 86, 1);

  place(3, 320, 356, getVal(h, "broker_firm"),    40, 1, 8.5);
  place(3, 295, 368, getVal(h, "inspector_name"), 44, 1, 8.5);
  const dt = [getVal(h, "inspection_date"), getVal(h, "inspection_time")].filter(Boolean).join(" ");
  place(3, 121, 380, dt,                          28, 1, 8.5);
  place(3, 340, 380, getVal(h, "weather"),        30, 1, 8.5);
  place(3, 142, 392, getVal(h, "other_persons_present"), 58, 1, 8.5);

  return fields;
}

const SYSTEM_PROMPT = `You are an expert California real estate compliance assistant helping a listing agent complete a C.A.R. Form AVID (Agent Visual Inspection Disclosure, Revised 6/24).

Read the agent's walk-through transcript and extract observations mapped to each AVID field. Output ONLY valid JSON — no preamble, no markdown fences, no explanation.

JSON format:
{
  "header": {
    "property_address": "",
    "city": "",
    "county": "",
    "broker_firm": "",
    "inspection_date": "",
    "inspection_time": "",
    "weather": "",
    "other_persons_present": "",
    "inspector_name": ""
  },
  "interior": {
    "entry": {"text": "", "status": "captured|partial|missing"},
    "living_room": {"text": "", "status": "captured|partial|missing"},
    "dining_room": {"text": "", "status": "captured|partial|missing"},
    "kitchen": {"text": "", "status": "captured|partial|missing"},
    "other_room": {"text": "", "status": "captured|partial|missing"},
    "hall_stairs": {"text": "", "status": "captured|partial|missing"},
    "bedroom_1": {"text": "", "status": "captured|partial|missing"},
    "bedroom_2": {"text": "", "status": "captured|partial|missing"},
    "bedroom_3": {"text": "", "status": "captured|partial|missing"},
    "bedroom_4": {"text": "", "status": "captured|partial|missing"},
    "bath_1": {"text": "", "status": "captured|partial|missing"},
    "bath_2": {"text": "", "status": "captured|partial|missing"},
    "bath_3": {"text": "", "status": "captured|partial|missing"},
    "bath_4": {"text": "", "status": "captured|partial|missing"}
  },
  "exterior": {
    "garage_parking": {"text": "", "status": "captured|partial|missing"},
    "exterior_building_yard": {"text": "", "status": "captured|partial|missing"},
    "other_conditions": {"text": "", "status": "captured|partial|missing"}
  },
  "summary": {
    "captured_count": 0,
    "partial_count": 0,
    "missing_count": 0,
    "notes": ""
  }
}

Rules:
- Extract broker_firm from phrases like "Broker firm is: [name]"
- Extract inspector_name from phrases like "Inspector is: [name]"
- Extract inspection_date from phrases like "Date is: [date]"
- Extract inspection_time from phrases like "Time is: [time]"
- Extract weather from phrases like "Weather is: [conditions]"
- Extract other_persons_present from phrases like "Others present are: [names]"
- "text": concise professional AVID-style language (1-3 sentences max). Use "Agent observed...", "Visible..." etc.
- "status": "captured" = clear observation; "partial" = incomplete; "missing" = not addressed.
- If a room wasn't mentioned, write "Not observed." with status "missing".
- If item needs professional inspection, note "Refer to pest/licensed contractor report."
- Output ONLY the raw JSON object. No other text.`;

async function extractFromTranscript(transcript) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Agent walk-through transcript:\n\n${transcript}` }],
  });
  const raw = response.content.map(b => b.text || "").join("").trim();
  const clean = raw.replace(/^```json|^```|```$/gm, "").trim();
  return JSON.parse(clean);
}

async function fillPdf(pdfBytes, data) {
  const decryptedBytes = decryptPdf(pdfBytes);
  const pdfDoc = await PDFDocument.load(decryptedBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const fields = buildFields(data);
  for (const fld of fields) {
    if (!fld.text) continue;
    const page = pages[fld.page - 1];
    if (!page) continue;
    page.drawText(fld.text, { x: fld.x, y: fld.y, size: fld.fs || FS, font, color: rgb(0, 0, 0) });
  }
  return await pdfDoc.save();
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method not allowed" };

  try {
    const body = JSON.parse(event.body || "{}");
    const { transcript, pdfBase64, data: preExtractedData } = body;

    if (!transcript && !preExtractedData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "transcript or data is required" }) };
    }

    const data = preExtractedData || await extractFromTranscript(transcript);

    if (pdfBase64) {
      const pdfBytes = Buffer.from(pdfBase64, "base64");
      const filledBytes = await fillPdf(pdfBytes, data);
      const filledBase64 = Buffer.from(filledBytes).toString("base64");
      const address = (data.header?.property_address || "AVID").replace(/[^a-zA-Z0-9]/g, "_");
      return {
        statusCode: 200,
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: filledBase64, filename: `AVID_${address}.pdf`, data }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    };

  } catch (err) {
    console.error("fill-avid error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
