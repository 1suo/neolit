#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const command = process.argv[2];
const targetDir = process.cwd();

if (command === 'init') {
  init();
} else if (command === 'update') {
  update();
} else {
  console.log('Usage:');
  console.log('  npx neolit init     - Initialize neolit in current project');
  console.log('  npx neolit update   - Update core prompts (preserves customizations)');
}

function init() {
  const neolitDir = path.join(targetDir, 'neolit');
  const configPath = path.join(targetDir, '.neolit.json');
  
  if (fs.existsSync(neolitDir)) {
    console.log('neolit/ already exists. Aborting.');
    process.exit(1);
  }
  
  // Prompt for git tracking
  console.log('Track neolit/ in git?');
  console.log('  y = commit docs to repo (team collaboration)');
  console.log('  n = add to .gitignore (local only)');
  process.stdout.write('Choice (y/n): ');
  
  const stdin = fs.readFileSync(0, 'utf-8');
  const choice = stdin.trim().toLowerCase();
  
  // Copy templates
  const templateSource = path.join(__dirname, '..', 'templates', 'neolit');
  copyRecursive(templateSource, neolitDir);
  
  // Create config
  const config = {
    format: 'org',
    customPrompts: [],
    coreOverrides: {}
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  // Handle git tracking
  if (choice === 'n') {
    const gitignorePath = path.join(targetDir, '.gitignore');
    const ignoreEntry = '\n# Neolit AI documentation\nneolit/\n.neolit.json\n';
    
    if (fs.existsSync(gitignorePath)) {
      fs.appendFileSync(gitignorePath, ignoreEntry);
    } else {
      fs.writeFileSync(gitignorePath, ignoreEntry.trim() + '\n');
    }
    console.log('✓ Added neolit/ to .gitignore');
  }
  
  console.log('✓ Neolit initialized');
  console.log('');
  console.log('Next steps:');
  console.log('1. Fill neolit/VISION.org with project vision');
  console.log('2. Run: npx @anthropic-ai/claude-cli');
  console.log('3. Paste: @neolit/prompts/ANALYZE_PROJECT.md');
  console.log('');
  console.log('Docs: neolit/docs/system.md');
}

function update() {
  const neolitDir = path.join(targetDir, 'neolit');
  const configPath = path.join(targetDir, '.neolit.json');
  const templatesDir = path.join(__dirname, '..', 'templates', 'neolit');
  
  if (!fs.existsSync(neolitDir)) {
    console.log('neolit/ not found. Run: npx neolit init');
    process.exit(1);
  }
  
  const config = fs.existsSync(configPath) 
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : { format: 'org', customPrompts: [], coreOverrides: {} };
  
  const coreFiles = ['BASE.md', 'BUG.md', 'FEATURE.md', 'REFACTOR.md'];
  
  console.log('Updating neolit...');
  
  for (const file of coreFiles) {
    const userPath = path.join(neolitDir, 'prompts', file);
    const templatePath = path.join(templatesDir, 'prompts', file);
    
    if (!fs.existsSync(templatePath)) continue;
    
    if (!fs.existsSync(userPath)) {
      // New file, copy it
      fs.copyFileSync(templatePath, userPath);
      console.log(`✓ Added ${file}`);
      continue;
    }
    
    const userContent = fs.readFileSync(userPath, 'utf8');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    
    if (userContent === templateContent) {
      console.log(`  ${file} unchanged`);
      continue;
    }
    
    if (config.coreOverrides[file] === 'modified') {
      console.log(`  ${file} skipped (user modified)`);
      continue;
    }
    
    // Show diff
    console.log(`\n${file} has updates. Diff:`);
    try {
      execSync(`diff -u "${userPath}" "${templatePath}"`, { stdio: 'inherit' });
    } catch (e) {
      // diff exits 1 when files differ
    }
    
    // Mark as modified
    config.coreOverrides[file] = 'modified';
    console.log(`  Keeping your version. Review manually if needed.`);
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('\n✓ Update complete');
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  
  const stat = fs.statSync(src);
  
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(file => {
      copyRecursive(path.join(src, file), path.join(dest, file));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}
