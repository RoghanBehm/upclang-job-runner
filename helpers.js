const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises")
const { promisify } = require("util");
const { execFile } = require("child_process");
const { pipeline } = require("stream/promises");
const os = require("os");
const crypto = require("crypto");
const { getProject } = require("./dynamo");

const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const ssm = new SSMClient({ region: process.env.AWS_REGION || "ap-southeast-2" });

async function getParam(name, def) {
  try {
    const { Parameter } = await ssm.send(new GetParameterCommand({ Name: name }));
    return Parameter?.Value ?? def;
  } catch { return def; }
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

function isAdmin(user) {
	return user?.role === "admin";
}

async function getOwned(user, projectId) {
  const p = await getProject(projectId);
  if (!p) return null;
  if (isAdmin(user) || p.userId === user?.sub) return p;
  return null;
}

function projPath(userId, projectId) {
	const root = path.join(DATA_DIR, 'users', userId, 'projects', projectId);
	return {
		root
	};
}

function jobPath(userId, jobId) {
	const root = path.join(DATA_DIR, 'users', userId, 'jobs', jobId);
	return {
		root,
		report: path.join(root, 'report'),
		log: path.join(root, 'report', 'clang-tidy.txt')
	};
}

async function extractTar({ userId, projectId, tmpTar }) {
	const { root } = projPath(userId, projectId);

	// Clears and remakes the root dir
	await fsp.rm(root, { recursive: true, force: true });
	await fsp.mkdir(root, { recursive: true });

	await promisify(execFile)(
		'tar',
		['-xzf', tmpTar, '-C', root, '--strip-components=1', '--no-same-owner', '--no-same-permissions'],
		{ timeout: 60_000 }
	);
}

function isValidGitHub({ owner, repo, ref = '' }) {
	const nameRegex = /^[A-Za-z0-9._-]+$/;
	if (!nameRegex.test(owner) || !nameRegex.test(repo)) throw new Error("invalid owner or repo");
	return { owner, repo, ref: String(ref).trim() };
}




async function downloadGithubTar({ owner, repo, token }) {
  const base = (await getParam("/upclang/github/codeload_base", "https://codeload.github.com")).replace(/\/+$/,"");
  const url  = `${base}/${owner}/${repo}/tar.gz/main`; // Just using main branch, not passing branch name

  const headers = { "User-Agent": "upclang/1.0", "Accept": "*/*", ...(token && { Authorization: `Bearer ${token}` }) };
  const out = path.join(os.tmpdir(), `gh-${crypto.randomUUID()}.tgz`);
  const res = await fetch(url, { redirect: "follow", headers });
  if (!res.ok) throw new Error(`GitHub download failed: ${res.status} ${res.statusText}`);
  await pipeline(res.body, fs.createWriteStream(out));
  return out;
}

module.exports = { getOwned, projPath, jobPath, DATA_DIR, extractTar, downloadGithubTar, isValidGitHub };

