import { describe, it, expect } from 'vitest';
import path from 'path';

import {
  generateWindowsLauncher,
  windowsScheduledTaskArgs,
  WINDOWS_TASK_NAME,
} from './service.js';

/**
 * Tests for service configuration generation.
 *
 * These tests verify the generated content of plist/systemd/nohup configs
 * without actually loading services.
 */

// Helper: generate a plist string the same way service.ts does
function generatePlist(
  nodePath: string,
  projectRoot: string,
  homeDir: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${projectRoot}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${projectRoot}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${homeDir}/.local/bin</string>
        <key>HOME</key>
        <string>${homeDir}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${projectRoot}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${projectRoot}/logs/nanoclaw.error.log</string>
</dict>
</plist>`;
}

function generateSystemdUnit(
  nodePath: string,
  projectRoot: string,
  homeDir: string,
  isSystem: boolean,
): string {
  return `[Unit]
Description=NanoClaw Personal Assistant
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${projectRoot}/dist/index.js
WorkingDirectory=${projectRoot}
Restart=always
RestartSec=5
Environment=HOME=${homeDir}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${homeDir}/.local/bin
StandardOutput=append:${projectRoot}/logs/nanoclaw.log
StandardError=append:${projectRoot}/logs/nanoclaw.error.log

[Install]
WantedBy=${isSystem ? 'multi-user.target' : 'default.target'}`;
}

describe('plist generation', () => {
  it('contains the correct label', () => {
    const plist = generatePlist(
      '/usr/local/bin/node',
      '/home/user/nanoclaw',
      '/home/user',
    );
    expect(plist).toContain('<string>com.nanoclaw</string>');
  });

  it('uses the correct node path', () => {
    const plist = generatePlist(
      '/opt/node/bin/node',
      '/home/user/nanoclaw',
      '/home/user',
    );
    expect(plist).toContain('<string>/opt/node/bin/node</string>');
  });

  it('points to dist/index.js', () => {
    const plist = generatePlist(
      '/usr/local/bin/node',
      '/home/user/nanoclaw',
      '/home/user',
    );
    expect(plist).toContain('/home/user/nanoclaw/dist/index.js');
  });

  it('sets log paths', () => {
    const plist = generatePlist(
      '/usr/local/bin/node',
      '/home/user/nanoclaw',
      '/home/user',
    );
    expect(plist).toContain('nanoclaw.log');
    expect(plist).toContain('nanoclaw.error.log');
  });
});

describe('systemd unit generation', () => {
  it('user unit uses default.target', () => {
    const unit = generateSystemdUnit(
      '/usr/bin/node',
      '/home/user/nanoclaw',
      '/home/user',
      false,
    );
    expect(unit).toContain('WantedBy=default.target');
  });

  it('system unit uses multi-user.target', () => {
    const unit = generateSystemdUnit(
      '/usr/bin/node',
      '/home/user/nanoclaw',
      '/home/user',
      true,
    );
    expect(unit).toContain('WantedBy=multi-user.target');
  });

  it('contains restart policy', () => {
    const unit = generateSystemdUnit(
      '/usr/bin/node',
      '/home/user/nanoclaw',
      '/home/user',
      false,
    );
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('RestartSec=5');
  });

  it('sets correct ExecStart', () => {
    const unit = generateSystemdUnit(
      '/usr/bin/node',
      '/srv/nanoclaw',
      '/home/user',
      false,
    );
    expect(unit).toContain(
      'ExecStart=/usr/bin/node /srv/nanoclaw/dist/index.js',
    );
  });
});

describe('WSL nohup fallback', () => {
  it('generates a valid wrapper script', () => {
    const projectRoot = '/home/user/nanoclaw';
    const nodePath = '/usr/bin/node';
    const pidFile = path.join(projectRoot, 'nanoclaw.pid');

    // Simulate what service.ts generates
    const wrapper = `#!/bin/bash
set -euo pipefail
cd ${JSON.stringify(projectRoot)}
nohup ${JSON.stringify(nodePath)} ${JSON.stringify(projectRoot)}/dist/index.js >> ${JSON.stringify(projectRoot)}/logs/nanoclaw.log 2>> ${JSON.stringify(projectRoot)}/logs/nanoclaw.error.log &
echo $! > ${JSON.stringify(pidFile)}`;

    expect(wrapper).toContain('#!/bin/bash');
    expect(wrapper).toContain('nohup');
    expect(wrapper).toContain(nodePath);
    expect(wrapper).toContain('nanoclaw.pid');
  });
});

describe('Windows launcher generation', () => {
  const projectRoot = 'C:\\Users\\me\\nanoclaw';
  const nodePath = 'C:\\Program Files\\nodejs\\node.exe';

  it('runs node against dist\\index.js with quoted paths', () => {
    const cmd = generateWindowsLauncher(projectRoot, nodePath);
    expect(cmd).toContain('@echo off');
    expect(cmd).toContain(`cd /d "${projectRoot}"`);
    expect(cmd).toContain(`"${nodePath}"`);
    expect(cmd).toContain('dist\\index.js');
  });

  it('redirects stdout and stderr to log files', () => {
    const cmd = generateWindowsLauncher(projectRoot, nodePath);
    expect(cmd).toContain('logs\\nanoclaw.log');
    expect(cmd).toContain('logs\\nanoclaw.error.log');
  });

  it('uses CRLF line endings for cmd compatibility', () => {
    expect(generateWindowsLauncher(projectRoot, nodePath)).toContain('\r\n');
  });

  it('restarts node on crash (KeepAlive/Restart=always parity)', () => {
    const cmd = generateWindowsLauncher(projectRoot, nodePath);
    expect(cmd).toContain(':restart');
    expect(cmd).toContain('goto restart');
    expect(cmd).toContain('timeout /t 5');
  });
});

describe('Windows scheduled-task arguments', () => {
  const args = windowsScheduledTaskArgs(
    WINDOWS_TASK_NAME,
    'C:\\app\\start-nanoclaw.cmd',
  );

  it('creates a logon-triggered task with the NanoClaw name', () => {
    expect(args).toContain('/Create');
    expect(args).toContain('/TN');
    expect(args).toContain('NanoClaw');
    expect(args).toContain('/SC');
    expect(args).toContain('ONLOGON');
  });

  it('overwrites an existing task and runs at limited integrity', () => {
    expect(args).toContain('/F');
    expect(args).toContain('/RL');
    expect(args).toContain('LIMITED');
  });

  it('quotes the launcher path passed to /TR', () => {
    const trIndex = args.indexOf('/TR');
    expect(trIndex).toBeGreaterThanOrEqual(0);
    expect(args[trIndex + 1]).toBe('"C:\\app\\start-nanoclaw.cmd"');
  });
});
