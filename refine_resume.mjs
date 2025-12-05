import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
} from "docx";

// ---------------------------------------------------
// GEMINI SETUP
// ---------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const PRIMARY_MODEL = "gemini-pro-latest";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.0-flash"];

// ---------------------------------------------------
// CLI ARGS
// ---------------------------------------------------
function getArg(flag, def = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

// ---------------------------------------------------
// GEMINI CALL WITH FALLBACK
// ---------------------------------------------------
async function callGemini(prompt) {
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr = null;

  for (const modelName of models) {
    try {
      console.log(`Phase-2 using model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const txt = result.response.text() || "";

      if (!txt.trim()) {
        console.log("Model returned empty response. Trying fallback...");
        continue;
      }
      return txt;
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      console.error(`Model ${modelName} failed (${status}): ${err.message}`);
      if (status === 500 || status === 503) {
        console.log("Transient error — switching model...");
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("All models failed or empty output.");
}

// ---------------------------------------------------
// TEXT HELPERS
// ---------------------------------------------------
function extract(tag, text) {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function splitLines(txt) {
  return txt
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// ---------------------------------------------------
// DOCX BUILDER — FIX ALL TO CALIBRI
// ---------------------------------------------------
const FONT = "Calibri";

async function buildDocx(text, outPath) {
  const CONTACT = extract("CONTACT", text);
  const SUMMARY = extract("SUMMARY", text);
  const ACH = extract("ACHIEVEMENTS", text);
  const CORE = extract("CORE_SKILLS", text);
  const EXP = extract("EXPERIENCE", text);
  const PROJ = extract("PROJECTS", text);
  const TECH = extract("TECHNICAL_SKILLS", text);
  const CERT = extract("CERTIFICATIONS", text);
  const EDU = extract("EDUCATION", text);

  const BODY_SIZE = 22; // 11pt
  const HEADING_SIZE = 26; // 13pt
  const NAME_SIZE = 38; // 19pt

  function run(t, opts = {}) {
    return new TextRun({ text: t, font: FONT, size: BODY_SIZE, ...opts });
  }

  function heading(t) {
    return new Paragraph({
      children: [
        new TextRun({
          text: t,
          font: FONT,
          bold: true,
          size: HEADING_SIZE,
          allCaps: true,
        }),
      ],
      spacing: { before: 200, after: 100 },
    });
  }

  function bullet(t) {
    return new Paragraph({
      text: t,
      bullet: { level: 0 },
      spacing: { after: 60 },
    });
  }

  const children = [];

  // -------------------- FIXED HEADER --------------------
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "Keshav Karn", font: FONT, size: NAME_SIZE, bold: true }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
    })
  );

  children.push(
    new Paragraph({
      children: [run("Hyderabad, India | 8520977573 | keshav.karn@gmail.com")],
      spacing: { after: 20 },
    })
  );

  children.push(
    new Paragraph({
      children: [
        run("LinkedIn: https://www.linkedin.com/in/keshavkarn/ | Credly: https://www.credly.com/users/keshav-karn"),
      ],
      spacing: { after: 20 },
    })
  );

  // -------------------- SUMMARY --------------------
  if (SUMMARY) {
    children.push(heading("PROFESSIONAL SUMMARY"));
    splitLines(SUMMARY).forEach((line) => children.push(new Paragraph({ children: [run(line)], spacing: { after: 80 } })));
  }

  // -------------------- ACHIEVEMENTS --------------------
  if (ACH) {
    children.push(heading("ACHIEVEMENTS"));
    splitLines(ACH).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  // -------------------- CORE SKILLS --------------------
  if (CORE) {
    children.push(heading("CORE SKILLS"));
    children.push(
      new Paragraph({
        children: [run(splitLines(CORE).join(" | "))],
        spacing: { after: 120 },
      })
    );
  }

  // -------------------- EXPERIENCE --------------------
  if (EXP) {
    children.push(heading("EXPERIENCE"));
    const lines = EXP.split("\n");
    let buf = [];

    function flush() {
      if (!buf.length) return;
      const arr = splitLines(buf.join("\n"));
      if (!arr.length) return;

      children.push(
        new Paragraph({
          children: [run(arr[0], { bold: true })],
          spacing: { before: 160, after: 60 },
        })
      );

      arr.slice(1).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));

      buf = [];
    }

    for (const line of lines) {
      if (line.trim().startsWith("Company:")) flush();
      buf.push(line);
    }
    flush();
  }

  // -------------------- PROJECTS --------------------
  if (PROJ && PROJ.trim()) {
    children.push(heading("PROJECTS"));
    splitLines(PROJ).forEach((line) => {
      if (line.startsWith("-")) children.push(bullet(line.replace(/^-+\s*/, "")));
      else
        children.push(
          new Paragraph({
            children: [run(line)],
            spacing: { after: 80 },
          })
        );
    });
  }

  // -------------------- TECHNICAL SKILLS --------------------
  if (TECH) {
    children.push(heading("TECHNICAL SKILLS"));
    splitLines(TECH).forEach((l) => children.push(new Paragraph({ children: [run(l)], spacing: { after: 80 } })));
  }

  // -------------------- CERTIFICATIONS --------------------
  if (CERT) {
    children.push(heading("CERTIFICATIONS"));
    splitLines(CERT).forEach((l) => children.push(bullet(l.replace(/^-+\s*/, ""))));
  }

  // -------------------- EDUCATION --------------------
  if (EDU) {
    children.push(heading("EDUCATION"));
    splitLines(EDU).forEach((l) =>
      children.push(
        new Paragraph({
          text: l.replace(/^-+\s*/, ""),
          bullet: { level: 0 },
        })
      )
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1150, right: 1150 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
}

// ---------------------------------------------------
// MAIN: Recruiter review → Rewrite
// ---------------------------------------------------
async function main() {
  const jdFile = getArg("--job-desc-file");
  const rawFile = getArg("--raw-file");
  const outDir = getArg("--out-dir", "refined_output");

  if (!jdFile || !rawFile) {
    console.error("Usage: node refine_resume.mjs --job-desc-file jd.txt --raw-file raw.txt");
    process.exit(1);
  }

  const jd = fs.readFileSync(jdFile, "utf8");
  const raw = fs.readFileSync(rawFile, "utf8");
  const systemPrompt = fs.readFileSync(path.join("templates", "system_prompt.txt"), "utf8");

  // ---------------- REVIEW ----------------
  const reviewPrompt = `
You are a senior recruiter performing a strict evaluation of a candidate applying for a high-level technology leadership role.

You MUST identify:
• Missing alignment between summary and JD  
• Missing keywords for Agentic AI / SRE / Cloud / FinOps / Leadership  
• Weak bullets lacking measurable impact  
• Tone mismatches (seniority not reflected)  
• Sections too long, vague, or irrelevant  
• Any ATS risks  
• Whether PROJECTS are relevant or should be suppressed  
• Whether SUMMARY needs a final “fit for role” line  

Return ONLY:

[REVIEW]
- item 1
- item 2
...
[/REVIEW]

JOB DESCRIPTION:
${jd}

RESUME:
${raw}
`;

  let review = await callGemini(reviewPrompt);
  if (!review.includes("[REVIEW]")) {
    review = "[REVIEW]\n(No review returned)\n[/REVIEW]";
  }

  // ---------------- IMPROVE ----------------
  const improvePrompt = `
${systemPrompt}

You are now rewriting the resume using:
- REVIEW_NOTES
- JOB_DESCRIPTION
- ORIGINAL_RESUME

REVIEW_NOTES:
${review}

JOB_DESCRIPTION:
${jd}

ORIGINAL_RESUME:
${raw}

IMPORTANT:
✔ use strict tag format ONLY  
✔ ensure SUMMARY strongly aligns  
✔ add 1-line “fit for role” closing sentence  
✔ PROJECTS only when applicable (infra+dev or dev-only)  
✔ Use ALL Calibri formatting conventions indirectly (handled by DOCX)  

Now output ONLY the tagged resume, no commentary.
`;

  const improved = await callGemini(improvePrompt);

  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "review.txt"), review, "utf8");
  fs.writeFileSync(path.join(outDir, "refined_raw.txt"), improved, "utf8");

  await buildDocx(improved, path.join(outDir, "refined_resume.docx"));

  console.log("Refinement complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
