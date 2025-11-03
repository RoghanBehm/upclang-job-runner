const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");
const { getJob, updateJob } = require("./dynamo"); 
const sqs = new SQSClient({ region: "ap-southeast-2" });
const DLQ_URL = "https://sqs.ap-southeast-2.amazonaws.com/901444280953/job-queue-clang-dlq";

const TERMINAL = new Set(["finished","failed","canceled"]);

async function handleDLQMessage(m) {

  let payload = null;
  try { payload = JSON.parse(m.Body); } catch (_) {}
  const jobId = payload?.jobId;
  const receiveCount = m.Attributes?.ApproximateReceiveCount;

  if (!jobId) {
    console.error("DLQ msg missing jobId; leaving message for manual inspection");
    return false; 
  }


  let job = null;
  try { job = await getJob(jobId); } catch {}
  if (!job) {
    console.warn("DLQ for unknown job", jobId, "deleting to avoid loop");
    return true; 
  }
  if (TERMINAL.has(job.status)) {
    console.log("Job already terminal:", jobId, job.status);
    return true; 
  }

  await updateJob(jobId, {
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: "exceeded maxReceiveCount → DLQ",
    lastReceiveCount: receiveCount ? Number(receiveCount) : undefined,
    dlq: true
  });

  console.log("Job marked failed from DLQ:", jobId);
  return true;
}

(async function loop() {
  while (true) {
    const resp = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: DLQ_URL,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 20,
      AttributeNames: ["ApproximateReceiveCount","SentTimestamp","ApproximateFirstReceiveTimestamp"],
    }));
    if (!resp.Messages || !resp.Messages.length) continue;

    for (const m of resp.Messages) {
      try {
        const okToDelete = await handleDLQMessage(m);
        if (okToDelete) {
          await sqs.send(new DeleteMessageCommand({ QueueUrl: DLQ_URL, ReceiptHandle: m.ReceiptHandle }));
        }
      } catch (e) {
        console.error("DLQ handler error:", e);
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
