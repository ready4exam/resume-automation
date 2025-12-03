
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function getArg(flag, defaultValue = "") {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return defaultValue;
  return process.argv[idx + 1];
}

async function main() {
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jobDescFile = getArg("--job-desc-file");
  const extra = getArg("--extra", "");

  if (!company || !jobTitle || !jobDescFile) {
    console.error("Usage: node tailor_resume.mjs --company \"X\" --job-title \"Y\" --job-desc-file jd.txt [--extra \"notes\"]");
    process.exit(1);
  }

  const baseResumePath = path.join(process.cwd(), "base_resume.md");
  const systemPromptPath = path.join(process.cwd(), "templates", "system_prompt.txt");
  const jobDescPath = path.join(process.cwd(), jobDescFile);

  const baseResume = fs.readFileSync(baseResumePath, "utf8");
  const systemPrompt = fs.readFileSync(systemPromptPath, "utf8");
  const jobDesc = fs.readFileSync(jobDescPath, "utf8");

  const userPrompt = `
COMPANY: ${company}
TARGET JOB TITLE: ${jobTitle}

JOB DESCRIPTION:
${jobDesc}

EXTRA INSTRUCTIONS FROM CANDIDATE (OPTIONAL):
${extra || "(none)"}

BASE RESUME:
${baseResume}
`.trim();

  const response = await client.responses.create({
    model: "gpt-5.1-mini", // or gpt-4.1 or any suitable model
    input: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userPrompt
      }
    ]
  });

  const text =
    response.output[0].content[0].text || "ERROR: No text output from model.";

  const safeCompany = company.replace(/[^a-z0-9]+/gi, "_");
  const safeTitle = jobTitle.replace(/[^a-z0-9]+/gi, "_");
  const outFile = path.join(
    process.cwd(),
    "output",
    `resume_${safeCompany}_${safeTitle}.md`
  );

  if (!fs.existsSync(path.join(process.cwd(), "output"))) {
    fs.mkdirSync(path.join(process.cwd(), "output"));
  }

  fs.writeFileSync(outFile, text, "utf8");
  console.log(`Tailored resume written to: ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
