const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");


// helpers for performing I/O operations on S3 store

const { S3Client, PutObjectCommand, GetObjectCommand,
        ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const BUCKET = process.env.BUCKET || "a2-outputs";
const REGION = process.env.AWS_REGION || "ap-southeast-2";

const s3 = new S3Client({ region: REGION });


const putFile = async (filePath, Key, ContentType="application/octet-stream") =>
  s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: fs.createReadStream(filePath), ContentType }));

const getToFile = async (Key, outFile) => {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await new Promise((resolve, reject) => res.Body.pipe(fs.createWriteStream(outFile)).on("finish", resolve).on("error", reject));
  return outFile;
};
 
const presignGet = (Key, seconds=900) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key }), { expiresIn: seconds });

const deletePrefix = async (Prefix) => {
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix, ContinuationToken: token }));
    const Objects = (page.Contents || []).map(o => ({ Key: o.Key }));
    if (Objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects, Quiet: true } }));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
};

module.exports = { s3, BUCKET, putFile, getToFile, presignGet, deletePrefix };
