import './support/tapeExtensions'

import { execSync as exec } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import test from 'tape'


const fixtureDir = path.join(__dirname, 'fixtures/proj-a')
const pkgName = 'ts-transformer-inline-file'

const readFile = (filename: string) => fs.readFileSync(filename, 'utf8')


test('build fixture project', t => {
  process.chdir(fixtureDir)

  // --force: yarn otherwise keeps a stale copy of this package from an earlier run.
  exec('yarn install --force', { stdio: 'inherit' })
  exec('yarn clean', { stdio: 'inherit' })
  exec('yarn build', { stdio: 'inherit' })

  t.assert(fs.existsSync('./lib'), 'the outDir was created')

  t.end()
})

test('$INLINE_FILE', t => {
  const source = readFile('./lib/inline-file.js')

  t.notIncludes(source, '$INLINE_FILE')
  t.includes(source, "foo = \"lorem ipsum dolor\\n\".split(' ')")

  t.notIncludes(source, `require("${pkgName}")`)

  t.end()
})

test('$INLINE_JSON', t => {
  const source = readFile('./lib/inline-json.js')

  t.notIncludes(source, '$INLINE_JSON')
  t.includes(source, 'foo = { "str": "lol", "num-x": 42, "ary": ["foo", false], "obj": { "a": null } }')

  t.notIncludes(source, `require("${pkgName}")`)

  t.end()
})

test('$INLINE_JSON with object destructuring', t => {
  const source = readFile('./lib/inline-json-obj-destructuring.js')

  t.notIncludes(source, '$INLINE_JSON')
  t.includes(source, '{ name, version: VER } = { "name": "fixture-package", "version": "0.1.0" }')

  t.notIncludes(source, `require("${pkgName}")`)

  t.end()
})

test('ts-inline-file-invalidate keeps the build info when no inlined file changed', t => {
  const buildInfo = './lib/tsconfig.tsbuildinfo'
  t.assert(fs.existsSync(buildInfo), 'the build info exists')

  const output = exec('yarn --silent ts-inline-file-invalidate', { encoding: 'utf8' })

  t.equal(output, '', 'nothing is reported')
  t.assert(fs.existsSync(buildInfo), 'the build info is kept')

  t.end()
})

test('editing only an inlined file triggers a rebuild', t => {
  const words = './src/words.txt'
  const original = readFile(words)
  t.teardown(() => {
    fs.writeFileSync(words, original)
    exec('yarn build', { stdio: 'inherit' })
  })

  fs.writeFileSync(words, 'sit amet\n')
  // Make sure the edit is newer than the build info, whatever the mtime resolution.
  const future = new Date(Date.now() + 10_000)
  fs.utimesSync(words, future, future)

  exec('yarn build', { stdio: 'inherit' })

  t.includes(readFile('./lib/inline-file.js'), "foo = \"sit amet\\n\".split(' ')")

  t.end()
})
