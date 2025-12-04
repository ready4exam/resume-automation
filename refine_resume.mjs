import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function ai(model, prompt) {
  const m = genAI.getGenerativeModel({ model });
  const r = await m.generateContent(prompt);
  return r.response.text();
}

function getArg(flag, def = "") {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return def;
  return process.argv[i + 1];
}

// ---------------------------
// MAIN
// ---------------------------
async function main() {
  const jobDescFile = getArg("--job-desc-file");
  const rawFile = getArg("--raw-file");
  const outDir = getArg("--out-dir", "refined_output");

  if (!jobDescFile || !rawFile) {
    console.error(
      'Usage: node refine_resume.mjs --job-desc-file jd.txt --raw-file raw.txt [--out-dir folder]'
    );
    process.exit(1);
  }

  const jd = fs.readFileSync(jobDescFile, "utf8");
  const rawResume = fs.readFileSync(rawFile, "utf8");
  const systemPrompt = fs.readFileSync(
    path.join("templates", "system_prompt.txt"),
    "utf8"
  );

  // ---------------------------
  // STEP 1: Ask Gemini to review the resume
  // ---------------------------
  const reviewPrompt = `
You are a senior recruiter evaluating a resume for the following job:

JOB DESCRIPTION:
${jd}

Below is the AI-generated resume output from Phase 1.

RESUME:
${rawResume}

TASK:
1. Identify all gaps where the candidate could better align to the JD.
2. Identify missing or weak keywords.
3. Identify any bullet points that could be more impactful.
4. Identify opportunities to strengthen the summary.
5. Provide a list of improvements WITHOUT rewriting the resume.
6. Output ONLY inside these tags:

[REVIEW]
- improvement 1
- improvement 2
...
[/REVIEW]
`.trim();

  let review = await ai("gemini-pro-latest", reviewPrompt);

  if (!review.includes("[REVIEW]")) {
    review = "[REVIEW]\n(No explicit review returned)\n[/REVIEW]";
  }

  // ---------------------------
  // STEP 2: Improve the resume using the review + JD
  // ---------------------------
  const improvePrompt = `
${systemPrompt}

You will now produce an IMPROVED resume using the same STRICT TAG FORMAT by:

- Applying the review notes below
- Increasing relevance to the job description
- Tightening language
- Strengthening measurable outcomes
- Ensuring perfect ATS optimization

REVIEW_NOTES:
${review}

JOB_DESCRIPTION:
${jd}

ORIGINAL_RESUME:
${rawResume}

Now output the improved resume using ONLY the strict tag format from system_prompt.txt.
`.trim();

  const improved = await ai("gemini-pro-latest", improvePrompt);

  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "review.txt"), review, "utf8");
  fs.writeFileSync(path.join(outDir, "refined_raw.txt"), improved, "utf8");

  console.log("Review:", path.join(outDir, "review.txt"));
  console.log("Improved Resume:", path.join(outDir, "refined_raw.txt"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
