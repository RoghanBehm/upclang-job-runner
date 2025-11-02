const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } = require("@aws-sdk/client-sqs");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const { getToFile, putFile } = require("./s3IO");
const { updateJob } = require("./dynamo");
const log = (...a) => console.log(new Date().toISOString(), ...a);

const sqs = new SQSClient({ region: "ap-southeast-2" });
const QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/901444280953/job-queue-clang";
const VISIBILITY_SEC = parseInt("900", 10);
const HEARTBEAT_SEC = 30;

async function extractTar(tarFile, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const p = spawn("tar", ["-xzf", tarFile, "-C", outDir], { stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`tar -x exit ${code}`)));
  });
}

async function handle(msg) {
  log("got message", { receipt: msg.ReceiptHandle.slice(0,16) + "..." });
  const body = JSON.parse(msg.Body);
  const { jobId, projectId, userId, profile, sourceKey, s3LogKey } = body;
  log("parsed", { jobId, projectId, profile, sourceKey, s3LogKey });
  await updateJob(jobId, { status: "running", startedAt: new Date().toISOString() });
  log("job -> running", jobId);
  const workDir = `/tmp/job-${jobId}`;
  const srcTar  = path.join(workDir, "src.tar.gz");
  const srcDir  = path.join(workDir, "src");
  const outDir  = path.join(workDir, "out");

  await fs.mkdir(workDir, { recursive: true });
  log("downloading source", { sourceKey, dst: srcTar });
  await getToFile(sourceKey, srcTar);
  log("extract to", srcDir);     
  await extractTar(srcTar, srcDir);


  let alive = true;
  const hb = setInterval(async () => {
    if (!alive) return;
    await sqs.send(new ChangeMessageVisibilityCommand({
      QueueUrl: QUEUE_URL, ReceiptHandle: msg.ReceiptHandle, VisibilityTimeout: VISIBILITY_SEC
    }));
    log("heartbeat visibility extended", jobId);
  }, HEARTBEAT_SEC * 1000);

  const proc = spawn("bash", ["run_tidy.sh", srcDir, outDir], { cwd: path.resolve(__dirname, "..", "bash") });
  const exitCode = await new Promise((resolve) => proc.on("close", resolve));
  alive = false; clearInterval(hb);
  log("bash exit", { exitCode });
  try {
    const logPath = path.join(outDir, "report", "clang-tidy.txt");
    await putFile(logPath, s3LogKey, "text/plain");
  } catch (e) {
    await updateJob(jobId, { status: "failed", finishedAt: new Date().toISOString(), exitCode, error: "log upload failed" });
    throw e;
  } finally {
    try { await fs.rm(workDir, { recursive: true, force: true }); } catch {}
  }

  if (exitCode === 0) {
    await updateJob(jobId, { status: "finished", finishedAt: new Date().toISOString(), exitCode: 0 });
  } else {
    await updateJob(jobId, { status: "failed", finishedAt: new Date().toISOString(), exitCode: exitCode ?? -1 });
  }
}

async function loop() {
  while (true) {
    const resp = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: VISIBILITY_SEC
    }));
    if (!resp.Messages || !resp.Messages.length) continue;
    const msg = resp.Messages[0];
    try {
      await handle(msg);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: msg.ReceiptHandle }));
      log("deleted message", jobId);
    } catch (e) {
      console.error("worker error:", e);
    }
  }
}
loop().catch(e => { console.error(e); process.exit(1); });
