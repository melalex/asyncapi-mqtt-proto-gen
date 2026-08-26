'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const ASYNCAPI_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'asyncapi');

describe('end-to-end: asyncapi generate fromTemplate', () => {
  jest.setTimeout(120_000);

  let outDir;

  beforeAll(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asyncapi-mqtt-proto-gen-e2e-'));
    execFileSync(
      ASYNCAPI_BIN,
      [
        'generate',
        'fromTemplate',
        path.join(REPO_ROOT, 'test', 'fixtures', 'fleet-sample.yaml'),
        REPO_ROOT,
        '-p',
        'lang=cpp',
        '-p',
        'projectName=demo_bus',
        '-o',
        outDir,
        '--force-write',
      ],
      { cwd: REPO_ROOT, stdio: 'pipe' }
    );
  });

  afterAll(() => {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('writes the full project tree to disk, matching what buildFiles computed', () => {
    const expected = [
      '.gitignore',
      'CMakeLists.txt',
      'README.md',
      'include/demo_bus/message_bus.hpp',
      'include/demo_bus/mosquitto_transport.hpp',
      'include/demo_bus/mqtt_transport.hpp',
      'proto/commands.proto',
      'proto/control.proto',
      'proto/sensors.proto',
      'proto/telemetry.proto',
      'src/message_bus.cpp',
      'src/mosquitto_transport.cpp',
      'tests/fake_mqtt_transport.hpp',
      'tests/test_messages.cpp',
    ];
    for (const relPath of expected) {
      expect(fs.existsSync(path.join(outDir, relPath))).toBe(true);
    }
  });

  it('rejects an unsupported lang with a clear CLI error', () => {
    expect(() =>
      execFileSync(
        ASYNCAPI_BIN,
        [
          'generate',
          'fromTemplate',
          path.join(REPO_ROOT, 'test', 'fixtures', 'minimal.yaml'),
          REPO_ROOT,
          '-p',
          'lang=python',
          '-o',
          fs.mkdtempSync(path.join(os.tmpdir(), 'asyncapi-mqtt-proto-gen-e2e-bad-')),
          '--force-write',
        ],
        { cwd: REPO_ROOT, stdio: 'pipe' }
      )
    ).toThrow();
  });
});
