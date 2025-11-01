// helpers to emulate the local files paths by creating corresponding keys in S3

const ROOT = "data";

const projectPrefix = (userId, projectId) =>
  `${ROOT}/users/${userId}/projects/${projectId}/`;

const uploadKey   = (userId, projectId, name) =>
  `${projectPrefix(userId, projectId)}uploads/${name}`;

const reportKey   = (userId, projectId, jobId) =>
  `${projectPrefix(userId, projectId)}reports/${jobId}/clang-tidy.txt`;

const logKey      = (userId, projectId, jobId) =>
  `${projectPrefix(userId, projectId)}logs/${jobId}.log`;

module.exports = { projectPrefix, uploadKey, reportKey, logKey };


