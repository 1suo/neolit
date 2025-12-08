#!/usr/bin/env node

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

program
  .name('neolit')
  .description('AI-driven development scaffolding system')
  .version(require('../package.json').version);

program
  .command('init')
  .description('Initialize neolit in current project')
  .option('--format <type>', 'todo format (org|md)', 'org')
  .option('--git', 'add neolit files to git (default: ignored)')
  .action(async (options) => {
    const cwd = process.cwd();
    const templatesDir = path.join(__dirname, '../templates/neolit');
    const neolitDir = path.join(cwd, 'neolit');

    console.log('Initializing neolit...');

    // Create neolit directory
    fs.mkdirSync(neolitDir, { recursive: true });

    // Create .neolit.json config
    const config = {
      format: options.format,
      version: require('../package.json').version
    };
    fs.writeFileSync(
      path.join(cwd, '.neolit.json'),
      JSON.stringify(config, null, 2)
    );
    console.log('✓ Created .neolit.json');

    // Copy core files
    const coreToCopy = [
      'INTEGRATION.md',
      'README.md'
    ];

    coreToCopy.forEach(file => {
      const src = path.join(templatesDir, file);
      const dest = path.join(neolitDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`✓ Created ${file}`);
      }
    });

    // Copy prompts directory
    const promptsDir = path.join(neolitDir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    const promptsSrc = path.join(templatesDir, 'prompts');
    if (fs.existsSync(promptsSrc)) {
      fs.readdirSync(promptsSrc).forEach(file => {
        fs.copyFileSync(
          path.join(promptsSrc, file),
          path.join(promptsDir, file)
        );
      });
      console.log('✓ Created prompts/');
    }

    // Copy standard directory
    const standardDir = path.join(neolitDir, 'standard');
    const standardSrc = path.join(templatesDir, 'standard');
    if (fs.existsSync(standardSrc)) {
      fs.cpSync(standardSrc, standardDir, { recursive: true });
      console.log('✓ Created standard/');
    }

    // Copy templates
    const templatesTargetDir = path.join(neolitDir, 'templates');
    const templatesSource = path.join(templatesDir, 'templates');
    if (fs.existsSync(templatesSource)) {
      fs.cpSync(templatesSource, templatesTargetDir, { recursive: true });
      console.log('✓ Created templates/');
    }

    // Handle .gitignore
    const gitignorePath = path.join(cwd, '.gitignore');
    if (!options.git) {
      const gitignoreEntries = [
        '\n# Neolit AI documentation',
        'neolit/',
        '.neolit.json',
        '**/NEOLIT.md',
        '**/TODO.org',
        '**/TODO.org_archive'
      ].join('\n') + '\n';

      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        if (!content.includes('neolit/') && !content.includes('NEOLIT.md')) {
          fs.appendFileSync(gitignorePath, gitignoreEntries);
          console.log('✓ Added neolit entries to .gitignore');
        }
      } else {
        fs.writeFileSync(gitignorePath, gitignoreEntries);
        console.log('✓ Created .gitignore with neolit entries');
      }
    }

    console.log('\n✓ Neolit initialized successfully!');
    console.log('\nNext steps:');
    console.log('1. Create TODO.org in project root');
    console.log('2. Run: npx neolit analyze');
    console.log('3. Review generated NEOLIT.md files');
    console.log('4. Start working with AI using neolit/prompts/');
  });

program
  .command('analyze')
  .description('Analyze existing project and populate documentation')
  .action(() => {
    const neolitDir = path.join(process.cwd(), 'neolit');
    const promptFile = path.join(neolitDir, 'prompts', 'ANALYZE_PROJECT.md');
    
    if (!fs.existsSync(promptFile)) {
      console.error('Error: neolit not initialized. Run: npx neolit init');
      process.exit(1);
    }

    console.log('\nProject analysis prompt:');
    console.log('─'.repeat(50));
    console.log(fs.readFileSync(promptFile, 'utf-8'));
    console.log('─'.repeat(50));
    console.log('\nCopy this prompt to your AI assistant to analyze the project.');
  });

program
  .command('update')
  .description('Update neolit templates and prompts')
  .action(() => {
    console.log('Updating neolit core files...');
    
    const cwd = process.cwd();
    const neolitDir = path.join(cwd, 'neolit');
    const templatesDir = path.join(__dirname, '../templates/neolit');

    if (!fs.existsSync(neolitDir)) {
      console.error('Error: neolit not found. Run: npx neolit init');
      process.exit(1);
    }

    // Update only core files (not user-modified docs)
    const coreToUpdate = [
      'INTEGRATION.md',
      'README.md'
    ];

    coreToUpdate.forEach(file => {
      const src = path.join(templatesDir, file);
      const dest = path.join(neolitDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`✓ Updated ${file}`);
      }
    });

    // Update prompts
    const promptsDir = path.join(neolitDir, 'prompts');
    const promptsSrc = path.join(templatesDir, 'prompts');
    if (fs.existsSync(promptsSrc)) {
      fs.readdirSync(promptsSrc).forEach(file => {
        fs.copyFileSync(
          path.join(promptsSrc, file),
          path.join(promptsDir, file)
        );
      });
      console.log('✓ Updated prompts/');
    }

    console.log('\n✓ Update complete!');
    console.log('Note: User-modified NEOLIT.md files and custom prompts were preserved.');
  });

program
  .command('clean')
  .description('Remove all neolit files from project')
  .option('--force', 'Skip confirmation')
  .action((options) => {
    const cwd = process.cwd();
    const neolitDir = path.join(cwd, 'neolit');
    const configFile = path.join(cwd, '.neolit.json');

    if (!fs.existsSync(neolitDir) && !fs.existsSync(configFile)) {
      console.log('No neolit installation found.');
      return;
    }

    if (!options.force) {
      console.log('\nThis will remove:');
      console.log('- neolit/ directory and all documentation');
      console.log('- .neolit.json config file');
      console.log('- All NEOLIT.md files in project');
      console.log('- All TODO.org and TODO.org_archive files in project');
      console.log('\nRun with --force to confirm: npx neolit clean --force');
      return;
    }

    console.log('Cleaning neolit files...');

    // Remove neolit directory
    if (fs.existsSync(neolitDir)) {
      fs.rmSync(neolitDir, { recursive: true, force: true });
      console.log('✓ Removed neolit/');
    }

    // Remove config file
    if (fs.existsSync(configFile)) {
      fs.unlinkSync(configFile);
      console.log('✓ Removed .neolit.json');
    }

    // Find and remove NEOLIT.md files
    try {
      const neolitFiles = execSync(
        'find . -name "NEOLIT.md" -not -path "*/node_modules/*" -not -path "*/.git/*"',
        { cwd, encoding: 'utf-8' }
      ).trim().split('\n').filter(Boolean);
      
      neolitFiles.forEach(file => {
        const fullPath = path.join(cwd, file);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`✓ Removed ${file}`);
        }
      });
    } catch (e) {
      // No files found
    }

    // Find and remove TODO.org and TODO.org_archive files
    try {
      const todoFiles = execSync(
        'find . \\( -name "TODO.org" -o -name "TODO.org_archive" \\) -not -path "*/node_modules/*" -not -path "*/.git/*"',
        { cwd, encoding: 'utf-8' }
      ).trim().split('\n').filter(Boolean);
      
      todoFiles.forEach(file => {
        const fullPath = path.join(cwd, file);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`✓ Removed ${file}`);
        }
      });
    } catch (e) {
      // No files found
    }

    console.log('\n✓ Cleanup complete!');
  });

program.parse();
