const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const payload = JSON.parse(process.env.PAYLOAD || '{}');
const task = payload.task;

console.log('Running:', task);

switch(task) {

  case 'deploy_site':
    const target = payload.target || 'sites/default';
    fs.mkdirSync(target, { recursive: true });
    for (const file of (payload.files || [])) {
      const fp = path.join(target, file.path);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, file.content);
    }
    break;

  case 'run_script':
    const code = payload.code || '';
    fs.writeFileSync('/tmp/script.js', code);
    console.log(execSync('node /tmp/script.js', { encoding: 'utf8' }));
    break;

  case 'clone_template':
    execSync(`git clone --depth 1 ${payload.source} projects/${payload.project || 'cloned'}`);
    execSync(`rm -rf projects/${payload.project || 'cloned'}/.git`);
    break;

  case 'download_files':
    for (const item of (payload.urls || [])) {
      execSync(`curl -L -o downloads/${item.path} ${item.url}`);
    }
    break;

  case 'build_apk':
    const projectDir = 'android-project';
    fs.mkdirSync(projectDir, { recursive: true });
    for (const file of (payload.files || [])) {
      const fp = path.join(projectDir, file.path);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, file.content);
    }
    console.log('Android project files created.');
    break;

  default:
    console.log('Unknown task:', task);
}
