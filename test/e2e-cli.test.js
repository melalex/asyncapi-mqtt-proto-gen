'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const ASYNCAPI_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'asyncapi');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'fleet-sample.yaml');

function generate(lang, outDir) {
  execFileSync(
    ASYNCAPI_BIN,
    ['generate', 'fromTemplate', FIXTURE, REPO_ROOT, '-p', `lang=${lang}`, '-p', 'projectName=demo_bus', '-o', outDir, '--force-write'],
    { cwd: REPO_ROOT, stdio: 'pipe' }
  );
}

describe('end-to-end: asyncapi generate fromTemplate', () => {
  jest.setTimeout(120_000);

  const outDirs = [];
  afterAll(() => {
    for (const dir of outDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function tmpOutDir(suffix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `asyncapi-mqtt-proto-gen-e2e-${suffix}-`));
    outDirs.push(dir);
    return dir;
  }

  describe('-p lang=cpp', () => {
    let outDir;

    beforeAll(() => {
      outDir = tmpOutDir('cpp');
      generate('cpp', outDir);
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
  });

  describe('-p lang=python', () => {
    let outDir;

    beforeAll(() => {
      outDir = tmpOutDir('python');
      generate('python', outDir);
    });

    it('writes the full project tree to disk, matching what buildFiles computed', () => {
      const expected = [
        '.gitignore',
        'Makefile',
        'README.md',
        'pyproject.toml',
        'proto/demo_bus/commands.proto',
        'proto/demo_bus/control.proto',
        'proto/demo_bus/sensors.proto',
        'proto/demo_bus/telemetry.proto',
        'src/demo_bus/__init__.py',
        'src/demo_bus/client.py',
        'tests/test_client.py',
      ];
      for (const relPath of expected) {
        expect(fs.existsSync(path.join(outDir, relPath))).toBe(true);
      }
    });
  });

  it('rejects an unsupported lang with a clear CLI error', () => {
    expect(() => generate('rust', tmpOutDir('bad'))).toThrow();
  });
});
