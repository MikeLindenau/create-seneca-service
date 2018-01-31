
const os = require('os')
const path = require('path')
const execSync = require('child_process').execSync
const fs = require('fs-extra')
const chalk = require('chalk')
const commander = require('commander')
const spawn = require('cross-spawn')
const semver = require('semver')
const hyperquest = require('hyperquest')

const packageJson = require('./package.json')

// These files should be allowed to remain on a failed install,
// but then silently removed during the next create.
const errorLogFilePatterns = [
  'npm-debug.log',
  'yarn-error.log',
  'yarn-debug.log',
]

const program = new commander.Command(packageJson.name)
  .version(packageJson.version)
  .arguments('<project-directory>')
  .usage(`${chalk.green('<project-directory>')} [options]`)
  .action(name => {
    projectName = name
  })
  .option(
    '--scripts-version <alternative-package>',
    'use a non-standard version of seneca-scripts'
  )
  .allowUnknownOption()
  .on('--help', () => {
    console.log(`    Only ${chalk.green('<project-directory>')} is required.`)
    console.log()
  })
  .parse(process.argv)


if (typeof projectName === 'undefined') {
  console.log()
  console.log()
  console.error('Please specify the project directory:')
  console.log(
    `  ${chalk.cyan(program.name())} ${chalk.green('<project-directory>')}`
  )
  console.log()
  console.log('For example:')
  console.log(`  ${chalk.cyan(program.name())} ${chalk.green('my-seneca-service')}`)
  console.log()
  console.log(
    `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
  )
  console.log()
  console.log()
  process.exit(1)
}

createApp(
  projectName,
  program.scriptsVersion
)

function createApp(name, version, verbose) {
  const root = path.resolve(name)
  const appName = path.basename(root)

  console.log({
    root, appName
  })

  checkAppName(appName)
  fs.ensureDirSync(name)
  
  if (!isSafeToCreateProjectIn(root, name)) {
    process.exit(1)
  }

  console.log(`Creating a new seneca service in ${chalk.green(root)}.`)
  console.log()

  const packageJson = {
    name: appName,
    version: '0.1.0',
    private: true,
  }

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(packageJson, null, 2) + os.EOL
  )

  const originalDirectory = process.cwd()
  process.chdir(root)
  
  if (!checkThatNpmCanReadCwd()) {
    process.exit(1)
  }

  if (!semver.satisfies(process.version, '>=8.0.0')) {
    console.log(
      chalk.red(
        `You are using Node ${process.version}.\n\n` +
          `Please update to Node 8 or higher.\n`
      )
    )
    // Fall back to latest supported react-scripts on Node 4
    process.exit(1)
  }

  const npmInfo = checkNpmVersion()

  if (!npmInfo.hasMinNpm) {
    if (npmInfo.npmVersion) {
      console.log(
        chalk.red(
          `You are using npm ${npmInfo.npmVersion}.\n\n` +
            `Please update to npm 5 or higher for a consistent, fully supported experience.\n`
        )
      )
    }

    console.log(
      chalk.red(
        `Couldn't find npm version.\n\n` +
          `Please insure npm 5 or higher has been installed globally.\n`
      )
    )

    process.exit(1)
  }

  run(root, appName, version, originalDirectory)
}

function run(root, appName, version, verbose, originalDirectory) {
  const packageToInstall = getInstallPackage(version, originalDirectory)
  const allDependencies = [
    // Base
    'seneca',
    'seneca-balance-client',

    // Testing
    'code',
    'lab',

    // Logging
    'pino',
    'seneca-pino-adapter',

    packageToInstall
  ]

  console.log('Installing packages. This might take a couple of minutes.')
  
  getPackageName(packageToInstall)
    .then(packageName => {
      return install(root, allDependencies, verbose).then(
        () => packageName
      );
    })
    .then(packageName => {
      setCaretRangeForRuntimeDeps(packageName)
      
      const scriptsPath = path.resolve(
        process.cwd(),
        'node_modules',
        packageName,
        'scripts',
        'init.js'
      )

      const init = require(scriptsPath)
      init(root, appName, verbose, originalDirectory)
    })
    .catch((reason) => {
      console.log();
      console.log('Aborting installation.');
      
      if (reason.command) {
        console.log(`  ${chalk.cyan(reason.command)} has failed.`);
      } else {
        console.log(chalk.red('Unexpected error. Please report it as a bug:'));
        console.log(reason);
      }

      console.log();

      // On 'exit' we will delete these files from target directory.
      const knownGeneratedFiles = ['package.json', 'node_modules'];
      const currentFiles = fs.readdirSync(path.join(root));
      
      currentFiles.forEach(file => {
        knownGeneratedFiles.forEach(fileToMatch => {
          // This remove all of knownGeneratedFiles.
          if (file === fileToMatch) {
            console.log(`Deleting generated file... ${chalk.cyan(file)}`);
            fs.removeSync(path.join(root, file));
          }
        });
      });

      const remainingFiles = fs.readdirSync(path.join(root));

      if (!remainingFiles.length) {
        // Delete target folder if empty
        console.log(
          `Deleting ${chalk.cyan(`${appName}/`)} from ${chalk.cyan(
            path.resolve(root, '..')
          )}`
        );
        process.chdir(path.resolve(root, '..'));
        fs.removeSync(path.join(root));
      }

      console.log('Done.');
      process.exit(1);
    })
}

function checkAppName(name) {
  // TODO: add rules for service naming convention
  return true
}

function isSafeToCreateProjectIn(root, name) {
  // TODO: insure its a clean dir or has valid files created by npm/git
  return true
}

function checkThatNpmCanReadCwd() {
  const cwd = process.cwd()
  let childOutput = null
  try {
    // Note: intentionally using spawn over exec since
    // the problem doesn't reproduce otherwise.
    // `npm config list` is the only reliable way I could find
    // to reproduce the wrong path. Just printing process.cwd()
    // in a Node process was not enough.
    childOutput = spawn.sync('npm', ['config', 'list']).output.join('')
  } catch (err) {
    // Something went wrong spawning node.
    // Not great, but it means we can't do this check.
    // We might fail later on, but let's continue.
    return true
  }
  if (typeof childOutput !== 'string') {
    return true
  }
  const lines = childOutput.split('\n')
  // `npm config list` output includes the following line:
  // " cwd = C:\path\to\current\dir" (unquoted)
  // I couldn't find an easier way to get it.
  const prefix = ' cwd = '
  const line = lines.find(line => line.indexOf(prefix) === 0)
  if (typeof line !== 'string') {
    // Fail gracefully. They could remove it.
    return true
  }
  const npmCWD = line.substring(prefix.length)
  if (npmCWD === cwd) {
    return true
  }
  console.error(
    chalk.red(
      `Could not start an npm process in the right directory.\n\n` +
        `The current directory is: ${chalk.bold(cwd)}\n` +
        `However, a newly started npm process runs in: ${chalk.bold(
          npmCWD
        )}\n\n` +
        `This is probably caused by a misconfigured system terminal shell.`
    )
  )
  if (process.platform === 'win32') {
    console.error(
      chalk.red(`On Windows, this can usually be fixed by running:\n\n`) +
        `  ${chalk.cyan(
          'reg'
        )} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n` +
        `  ${chalk.cyan(
          'reg'
        )} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n` +
        chalk.red(`Try to run the above two lines in the terminal.\n`) +
        chalk.red(
          `To learn more about this problem, read: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`
        )
    )
  }
  return false
}

function checkNpmVersion() {
  let hasMinNpm = false
  let npmVersion = null
  
  try {
    npmVersion = execSync('npm --version')
      .toString()
      .trim()
    hasMinNpm = semver.gte(npmVersion, '5.0.0')
  } catch (err) {
    // ignore
  }

  return {
    hasMinNpm: hasMinNpm,
    npmVersion: npmVersion,
  }
}

function getInstallPackage(version, originalDirectory) {
  let packageToInstall = 'seneca-scripts'
  const validSemver = semver.valid(version)
  if (validSemver) {
    packageToInstall += `@${validSemver}`
  } else if (version && version.match(/^file:/)) {
    packageToInstall = `file:${path.resolve(
      originalDirectory,
      version.match(/^file:(.*)?$/)[1]
    )}`
  } else if (version) {
    // for tar.gz or alternative paths
    packageToInstall = version
  }
  return packageToInstall
}

function getPackageName(installPackage) {
  if (installPackage.match(/^.+\.(tgz|tar\.gz)$/)) {
    return getTemporaryDirectory()
      .then(obj => {
        let stream
        if (/^http/.test(installPackage)) {
          stream = hyperquest(installPackage)
        } else {
          stream = fs.createReadStream(installPackage)
        }
        return extractStream(stream, obj.tmpdir).then(() => obj)
      })
      .then(obj => {
        const packageName = require(path.join(obj.tmpdir, 'package.json')).name
        obj.cleanup()
        return packageName
      })
      .catch(err => {
        // The package name could be with or without semver version, e.g. seneca-scripts-0.2.0-alpha.1.tgz
        // However, this function returns package name only without semver version.
        console.log(
          `Could not extract the package name from the archive: ${err.message}`
        )
        const assumedProjectName = installPackage.match(
          /^.+\/(.+?)(?:-\d+.+)?\.(tgz|tar\.gz)$/
        )[1]
        console.log(
          `Based on the filename, assuming it is "${chalk.cyan(
            assumedProjectName
          )}"`
        )
        return Promise.resolve(assumedProjectName)
      })
  } else if (installPackage.indexOf('git+') === 0) {
    // Pull package name out of git urls e.g:
    // git+https://github.com/mycompany/seneca-scripts.git
    // git+ssh://github.com/mycompany/seneca-scripts.git#v1.2.3
    return Promise.resolve(installPackage.match(/([^/]+)\.git(#.*)?$/)[1])
  } else if (installPackage.match(/.+@/)) {
    // Do not match @scope/ when stripping off @version or @tag
    return Promise.resolve(
      installPackage.charAt(0) + installPackage.substr(1).split('@')[0]
    )
  } else if (installPackage.match(/^file:/)) {
    const installPackagePath = installPackage.match(/^file:(.*)?$/)[1]
    const installPackageJson = require(path.join(
      installPackagePath,
      'package.json'
    ))
    return Promise.resolve(installPackageJson.name)
  }
  return Promise.resolve(installPackage)
}

function install(root, dependencies, verbose) {
  return new Promise((resolve, reject) => {
    let command
    let args
    
    command = 'npm'
    args = [
      'install',
      '--save',
      '--save-exact',
      '--loglevel',
      'error',
    ].concat(dependencies)

    if (verbose) {
      args.push('--verbose')
    }

    const child = spawn(command, args, { stdio: 'inherit' })
    
    child.on('close', code => {
      if (code !== 0) {
        reject({ command: `${command} ${args.join(' ')}` })
        return
      }
      resolve()
    })
  })
}

function makeCaretRange(dependencies, name) {
  const version = dependencies[name];

  if (typeof version === 'undefined') {
    console.error(chalk.red(`Missing ${name} dependency in package.json`));
    process.exit(1);
  }

  let patchedVersion = `^${version}`;

  if (!semver.validRange(patchedVersion)) {
    console.error(
      `Unable to patch ${name} dependency version because version ${chalk.red(
        version
      )} will become invalid ${chalk.red(patchedVersion)}`
    );
    patchedVersion = version;
  }

  dependencies[name] = patchedVersion;
}

function setCaretRangeForRuntimeDeps(packageName) {
  const packagePath = path.join(process.cwd(), 'package.json');
  const packageJson = require(packagePath);

  if (typeof packageJson.dependencies === 'undefined') {
    console.error(chalk.red('Missing dependencies in package.json'));
    process.exit(1);
  }

  const packageVersion = packageJson.dependencies[packageName];
  if (typeof packageVersion === 'undefined') {
    console.error(chalk.red(`Unable to find ${packageName} in package.json`));
    process.exit(1);
  }

  makeCaretRange(packageJson.dependencies, 'seneca');
  makeCaretRange(packageJson.dependencies, 'seneca-balance-client');
  makeCaretRange(packageJson.dependencies, 'pino');
  makeCaretRange(packageJson.dependencies, 'seneca-pino-adapter');

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + os.EOL);
}