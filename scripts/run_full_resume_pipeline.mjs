import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

// Small helper to get CLI args
function getArg(flag, def = "") {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return def;
  return process.argv[i + 1];
}

function run(cmd, args, options = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status || 1);
  }
}

async function main() {
  // These should mirror what you already pass to tailor_resume.mjs
  const company = getArg("--company");
  const jobTitle = getArg("--job-title");
  const jobDescFile = getArg("--job-desc-file"); // <- IMPORTANT
  const resumeMode = getArg("--resume-mode", "infra"); // example
  const methodologies = getArg("--methodologies", ""); // optional

  if (!company || !jobTitle || !jobDescFile) {
    console.error(
      "Usage: node scripts/run_full_resume_pipeline.mjs " +
        "--company \"Company\" " +
        "--job-title \"Role\" " +
        "--job-desc-file path/to/jd.txt " +
        "[--resume-mode infra|infra+development|development] " +
        "[--methodologies \"Agile,FinOps\"]"
    );
    process.exit(1);
  }

  // ---------------------------
  // 1) Run Phase-1 (tailor_resume.mjs)
  // ---------------------------
  // ⚠️ Adjust these args to match your existing tailor_resume.mjs exactly.
  run("node", [
    "scripts/tailor_resume.mjs",
    "--company",
    company,
    "--job-title",
    jobTitle,
    "--job-desc-file",
    jobDescFile,
    "--resume-mode",
    resumeMode,
    "--methodologies",
    methodologies,
  ]);

  // ---------------------------
  // 2) Locate Phase-1 outputs (raw.txt + job folder)
  // ---------------------------
  //
  // Here I'm assuming your Phase-1 already writes something like:
  // jobs/<slug>/raw.txt
  //
  // If you already know the job folder name pattern, you can compute it here.
  // For now I'll assume you store a "latest_job_path.txt" or similar, or you
  // define a deterministic folder name from company + job title.
  //
  // Replace this block with your real logic if needed.
  // ---------------------------

  // Example: derive a simple slug + folder
  const safeCompany = company.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const safeTitle = jobTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const jobFolder = path.join("jobs", `${safeCompany}__${safeTitle}`);

  const rawFile = path.join(jobFolder, "raw.txt");
  const phase2OutDir = path.join(jobFolder, "phase2");

  if (!fs.existsSync(rawFile)) {
    console.error(
      `Could not find Phase-1 raw resume at: ${rawFile}\n` +
        `Make sure tailor_resume.mjs writes raw.txt into that folder, or adjust the path logic here.`
    );
    process.exit(1);
  }

  // ---------------------------
  // 3) Run Phase-2 (refine_resume.mjs)
  // ---------------------------
  run("node", [
    "scripts/refine_resume.mjs",
    "--job-desc-file",
    jobDescFile,
    "--raw-file",
    rawFile,
    "--out-dir",
    phase2OutDir,
  ]);

  console.log("\n✅ Full pipeline complete.");
  console.log("Phase-1 raw:", rawFile);
  console.log("Phase-2 review + refined:", phase2OutDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
