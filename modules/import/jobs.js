const crypto = require('crypto');

const jobs = new Map();

function createJob(total) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id,
    status: 'running',
    total,
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    stubs: 0,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function cleanOldJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

setInterval(cleanOldJobs, 5 * 60 * 1000);

module.exports = { createJob, getJob };
