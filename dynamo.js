const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION   = process.env.AWS_REGION || "ap-southeast-2";
const PROJECTS = process.env.DDB_PROJECTS_TABLE;
const JOBS     = process.env.DDB_JOBS_TABLE;
const UNIQUES  = process.env.DDB_UNIQUES_TABLE;

if (!PROJECTS || !JOBS || !UNIQUES) {
  console.warn("[ddb] Missing table env vars; set DDB_PROJECTS_TABLE, DDB_JOBS_TABLE, DDB_UNIQUES_TABLE");
}

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
});

async function getProject(projectId) {
  const res = await ddb.send(new GetCommand({ TableName: PROJECTS, Key: { projectId } }));
  return res.Item || null;
}

async function createProject({ projectId, userId, name, createdAt = new Date().toISOString() }) {
  const guardKey = `USER#${userId}#NAME#${name}`;
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      { Put: {
          TableName: UNIQUES,
          Item: { u: guardKey, projectId, createdAt },
          ConditionExpression: "attribute_not_exists(#u)",
          ExpressionAttributeNames: { "#u": "u" }
      }},
      { Put: {
          TableName: PROJECTS,
          Item: { projectId, userId, name, createdAt },
          ConditionExpression: "attribute_not_exists(projectId)"
      }}
    ]
  }));
  return { projectId, userId, name, createdAt };
}

async function listProjectsForUser(userId, { offset = 0, limit = 20 } = {}) {
  let items = [];
  let lastKey;
  while (items.length < offset + limit) {
    const res = await ddb.send(new QueryCommand({
      TableName: PROJECTS,
      IndexName: "by_user_createdAt",
      KeyConditionExpression: "#u = :u",
      ExpressionAttributeNames: { "#u": "userId" },
      ExpressionAttributeValues: { ":u": userId },
      ScanIndexForward: false, // newest first
      Limit: Math.min(100, offset + limit - items.length),
      ExclusiveStartKey: lastKey
    }));
    items = items.concat(res.Items || []);
    if (!res.LastEvaluatedKey) break;
    lastKey = res.LastEvaluatedKey;
  }
  return items.slice(offset, offset + limit);
}

async function putJob(job) {
  await ddb.send(new PutCommand({
    TableName: JOBS,
    Item: job,
    ConditionExpression: "attribute_not_exists(jobId)"
  }));
}

async function updateJob(jobId, patch) {
  const sets = [];
  const names = {};
  const values = {};
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`#${k} = :${k}`);
    names[`#${k}`] = k;
    values[`:${k}`] = v;
  }
  await ddb.send(new UpdateCommand({
    TableName: JOBS,
    Key: { jobId },
    UpdateExpression: `SET ${sets.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values
  }));
}

async function getJob(jobId) {
  const res = await ddb.send(new GetCommand({ TableName: JOBS, Key: { jobId } }));
  return res.Item || null;
}

async function latestJobForProject(projectId) {
  const res = await ddb.send(new QueryCommand({
    TableName: JOBS,
    IndexName: "by_project_time",
    KeyConditionExpression: "#p = :p",
    ExpressionAttributeNames: { "#p": "projectId" },
    ExpressionAttributeValues: { ":p": projectId },
    ScanIndexForward: false,
    Limit: 1
  }));
  return (res.Items && res.Items[0]) || null;
}

async function listProjectsAdmin({ search = "", offset = 0, limit = 20 } = {}) {
  const TableName = PROJECTS;
  const FilterExpression = search
    ? "contains(#n, :q) OR contains(#u, :q)"
    : undefined;

  const ExpressionAttributeNames = search ? { "#n": "name", "#u": "userId" } : undefined;
  const ExpressionAttributeValues = search ? { ":q": search } : undefined;

  let items = [];
  let lastKey;
  while (items.length < offset + limit) {
    const res = await ddb.send(new ScanCommand({
      TableName,
      ...(FilterExpression && { FilterExpression, ExpressionAttributeNames, ExpressionAttributeValues }),
      Limit: Math.min(200, offset + limit - items.length),
      ExclusiveStartKey: lastKey,
    }));
    items = items.concat(res.Items || []);
    if (!res.LastEvaluatedKey) break;
    lastKey = res.LastEvaluatedKey;
  }
  items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return items.slice(offset, offset + limit);
}
module.exports = {
  getProject,
  createProject,
  listProjectsForUser,
  putJob,
  updateJob,
  getJob,
  latestJobForProject,
  listProjectsAdmin
};
