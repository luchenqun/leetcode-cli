'use strict';
var fs = require('fs');
var util = require('util');

var _ = require('underscore');
var childProcess = require('child_process');

var h = require('../helper');
var chalk = require('../chalk');
var icon = require('../icon');
var log = require('../log');
var config = require('../config');
var core = require('../core');
var session = require('../session');

const cmd = {
  command: 'show [keyword]',
  aliases: ['view', 'pick'],
  desc:    'Show question',
  builder: function(yargs) {
    return yargs
      .option('c', {
        alias:    'codeonly',
        type:     'boolean',
        default:  false,
        describe: 'Only show code template'
      })
      .option('e', {
        alias:    'editor',
        type:     'string',
        describe: 'Open source code in editor'
      })
      .option('g', {
        alias:    'gen',
        type:     'boolean',
        default:  false,
        describe: 'Generate source code'
      })
      .option('l', {
        alias:    'lang',
        type:     'string',
        default:  config.code.lang,
        describe: 'Programming language of the source code',
        choices:  config.sys.langs
      })
      .option('o', {
        alias:    'outdir',
        type:     'string',
        describe: 'Where to save source code',
        default:  '.'
      })
      .option('q', core.filters.query)
      .option('t', core.filters.tag)
      .option('x', {
        alias:    'extra',
        type:     'boolean',
        default:  false,
        describe: 'Show extra question details in source code'
      })
      .positional('keyword', {
        type:     'string',
        default:  '',
        describe: 'Show question by name or id'
      })
      .example(chalk.yellow('leetcode show 1'), 'Show question 1')
      .example(chalk.yellow('leetcode show 1 -gx -l java'), 'Show question 1 and generate Java code')
      .example(chalk.yellow('leetcode show 1 -gxe'), 'Open generated code in editor')
      .example('', '')
      .example(chalk.yellow('leetcode show'), 'Show random question')
      .example(chalk.yellow('leetcode show -q h'), 'Show random hard question')
      .example(chalk.yellow('leetcode show -t google'), 'Show random question from Google (require plugin)');
  }
};

function genFileName(problem, opts) {
  const path = require('path');
  const params = [
    problem.fid,
    problem.slug,
    '',
    h.langToExt(opts.lang)
  ];

  params[0] = ("00" + params[0]).substr(-3) + "-";
  // try to use a new filename to avoid overwrite by mistake
  let i = 0;
  // 转为 001-two-sum.cpp 的文件格式
  let name = path.join(opts.outdir, params.join('').replace(/\.+/g, '.'));
  // do {
  //   name = path.join(opts.outdir, params.join('.').replace(/\.+/g, '.'));
  //   params[2] = i++;
  // } while (fs.existsSync(name));
  return name;
}

function showProblem(problem, argv) {
  problem.discuss = problem.link.replace("leetcode-cn.com", "leetcode.com").replace("description", "discuss");

  const taglist = [problem.category]
    .concat(problem.companies || [])
    .concat(problem.tags || [])
    .map(x => h.badge(x, 'blue'))
    .join(' ');
  const langlist = problem.templates
    .map(x => h.badge(x.value, 'yellow'))
    .sort()
    .join(' ');

  let code;
  const needcode = argv.gen || argv.codeonly;
  if (needcode) {
    var template = problem.templates.find(x => x.value === argv.lang);
    if (!template) {
      log.fail('Not supported language "' + argv.lang + '"');
      log.warn('Supported languages: ' + langlist);
      return;
    } else {
      if(argv.lang === 'cpp'){
        var include = `
#include <iostream>
#include <string>
using namespace std;

`;

        template.defaultCode = include + template.defaultCode;

        var main = `

int main()
{
    Solution s;

    return 0;
}
        `
        template.defaultCode += main;
      } else if(argv.lang === 'golang') {
        var include = `
package main

`;

        template.defaultCode = include + template.defaultCode;

        var main = `

func main() {
  
}
        `
        template.defaultCode += main;
    }
    }

    const opts = {
      lang: argv.lang,
      code: template.defaultCode,
      tpl:  argv.extra ? 'detailed' : 'codeonly'
    };
    code = core.exportProblem(problem, opts);
  }

  let filename;
  if (argv.gen) {
    filename = genFileName(problem, argv);
    h.mkdir(argv.outdir);
    code = code.replace(/ \* \r\n/g, '');
    fs.writeFileSync(filename, code);

    if (argv.editor !== undefined) {
      childProcess.spawn(argv.editor || config.code.editor, [filename], {
        // in case your editor of choice is vim or emacs
        stdio: 'inherit'
      });
    }
  } else {
    if (argv.codeonly) {
      log.info(chalk.yellow(code));
      return;
    }
  }

  log.printf('[%d] %s %s', problem.fid, problem.name,
      (problem.starred ? chalk.yellow(icon.like) : icon.empty));
  log.info();
  log.info(chalk.underline(problem.link));
  if (argv.extra) {
    log.info();
    log.info('Tags:  ' + taglist);
    log.info();
    log.info('Langs: ' + langlist);
  }

  log.info();
  log.printf('* %s', problem.category);
  log.printf('* %s (%.2f%%)', h.prettyLevel(problem.level), problem.percent);

  if (filename)
    log.printf('* Source Code:       %s', chalk.yellow.underline(filename));
  if (problem.totalAC)
    log.printf('* Total Accepted:    %s', problem.totalAC);
  if (problem.totalSubmit)
    log.printf('* Total Submissions: %s', problem.totalSubmit);
  if (problem.testable && problem.testcase)
    log.printf('* Testcase Example:  %s', chalk.yellow(util.inspect(problem.testcase)));

  log.info();
  log.info(problem.desc);
}

cmd.handler = function(argv) {
  session.argv = argv;
  if (argv.keyword.length > 0) {
    // show specific one
    core.getProblem(argv.keyword, function(e, problem) {
      if (e) return log.fail(e);
      showProblem(problem, argv);
    });
  } else {
    // show random one
    core.filterProblems(argv, function(e, problems) {
      if (e) return log.fail(e);

      // random select one that not AC-ed yet
      const user = session.getUser();
      problems = problems.filter(function(x) {
        if (x.state === 'ac') return false;
        if (!user.paid && x.locked) return false;
        return true;
      });
      if (problems.length === 0) return log.fail('Problem not found!');

      const problem = _.sample(problems);
      core.getProblem(problem, function(e, problem) {
        if (e) return log.fail(e);
        showProblem(problem, argv);
      });
    });
  }
};

module.exports = cmd;
