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
  .action(async (options) => {
    const cwd = process.cwd();
    const templatesDir = path.join(__dirname, '../neolit');
    const neolitDir = path.join(cwd, '.neolit');

    console.log('Initializing neolit...');

    // Create .neolit directory
    fs.mkdirSync(neolitDir, { recursive: true });

    // Copy core files
    const coreToCopy = [
      'INTEGRATION.md',
      'README.md',
      'VISION.org'
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

    // Copy docs templates
    const docsDir = path.join(neolitDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const docsSrc = path.join(templatesDir, 'docs');
    if (fs.existsSync(docsSrc)) {
      fs.readdirSync(docsSrc).forEach(file => {
        fs.copyFileSync(
          path.join(docsSrc, file),
          path.join(docsDir, file)
        );
      });
      console.log('✓ Created docs/');
    }

    // Copy module templates
    const modulesDir = path.join(neolitDir, 'templates');
    const modulesSrc = path.join(templatesDir, 'templates');
    if (fs.existsSync(modulesSrc)) {
      fs.cpSync(modulesSrc, modulesDir, { recursive: true });
      console.log('✓ Created templates/');
    }

    console.log('\n✓ Neolit initialized successfully!');
    console.log('\nNext steps:');
    console.log('1. Run: npx neolit analyze');
    console.log('2. Review and fill .neolit/docs/system.md');
    console.log('3. Start working with AI on tasks in TODO.org files');
  });

program
  .command('analyze')
  .description('Analyze existing project and populate documentation')
  .action(() => {
    const neolitDir = path.join(process.cwd(), '.neolit');
    const promptFile = path.join(neolitDir, 'prompts', 'ANALYZE_PROJECT.md');
    
    if (!fs.existsSync(promptFile)) {
      console.error('Error: .neolit not initialized. Run: npx neolit init');
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
    const neolitDir = path.join(cwd, '.neolit');
    const templatesDir = path.join(__dirname, '../neolit');

    if (!fs.existsSync(neolitDir)) {
      console.error('Error: .neolit not found. Run: npx neolit init');
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
    console.log('Note: User documentation (docs/, VISION.org, prompts/BASE.md) was not modified.');
  });

program
  .command('clean')
  .description('Remove all neolit files from project')
  .option('--force', 'Skip confirmation')
  .action((options) => {
    const cwd = process.cwd();
    const neolitDir = path.join(cwd, '.neolit');

    if (!fs.existsSync(neolitDir)) {
      console.log('No neolit installation found.');
      return;
    }

    if (!options.force) {
      console.log('\nThis will remove:');
      console.log('- neolit/ directory and all documentation');
      console.log('- All CONTEXT.md files in project');
      console.log('- All TODO.org files in project');
      console.log('\nRun with --force to confirm: npx neolit clean --force');
      return;
    }

    console.log('Cleaning neolit files...');

    // Remove neolit directory
    if (fs.existsSync(neolitDir)) {
      fs.rmSync(neolitDir, { recursive: true, force: true });
      console.log('✓ Removed neolit/');
    }

    // Find and remove CONTEXT.md files
    try {
      const contextFiles = execSync(
        'find . -name "CONTEXT.md" -not -path "*/node_modules/*" -not -path "*/.git/*"',
        { cwd, encoding: 'utf-8' }
      ).trim().split('\n').filter(Boolean);
      
      contextFiles.forEach(file => {
        const fullPath = path.join(cwd, file);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`✓ Removed ${file}`);
        }
      });
    } catch (e) {
      // No files found
    }

    // Find and remove TODO.org files
    try {
      const todoFiles = execSync(
        'find . -name "TODO.org" -not -path "*/node_modules/*" -not -path "*/.git/*"',
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
