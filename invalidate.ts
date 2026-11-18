#!/usr/bin/env node
// The transformer reads inlined files outside of the compiler, so TypeScript
// never registers them as inputs. With `incremental` or `composite`, a build
// after editing only an inlined file is considered up to date and emits
// nothing. This command deletes the build info file when an inlined file is
// newer than it, so that the next build starts from scratch.
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'


const inlineFunctions = new Set(['$INLINE_FILE', '$INLINE_JSON'])
const stubModule = /(^|\/)ts-transformer-inline-file$/

/**
 * Returns the absolute paths of the files inlined in the given source file.
 */
export function findInlinedFiles (sourceFile: ts.SourceFile): string[] {
  const baseDir = path.dirname(sourceFile.fileName)
  const names = new Set(inlineFunctions)
  const files: string[] = []

  const visit = (node: ts.Node): void => {
    // Follow renamed imports: import { $INLINE_FILE as inline } from '...'
    if (ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && stubModule.test(node.moduleSpecifier.text)
      && node.importClause?.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const spec of node.importClause.namedBindings.elements) {
        if (inlineFunctions.has((spec.propertyName ?? spec.name).text)) {
          names.add(spec.name.text)
        }
      }
    }
    if (ts.isCallExpression(node) && isInlineCall(node.expression, names)) {
      const arg0 = node.arguments[0]
      if (arg0 && ts.isStringLiteral(arg0)) {
        files.push(path.resolve(baseDir, arg0.text))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return files
}

function isInlineCall (callee: ts.Expression, names: Set<string>): boolean {
  if (ts.isIdentifier(callee)) {
    return names.has(callee.text)
  }
  // Namespace import: inline.$INLINE_FILE(...)
  return ts.isPropertyAccessExpression(callee) && inlineFunctions.has(callee.name.text)
}

/**
 * Deletes the build info file of the given TypeScript project if a file
 * inlined by one of its sources is newer than it. Returns the inlined file
 * that caused the deletion, or `undefined` if the build info was kept.
 */
export function invalidate (configPath: string): string | undefined {
  const config = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diag => {
      throw new Error(ts.flattenDiagnosticMessageText(diag.messageText, '\n'))
    },
  })
  if (!config) {
    return undefined
  }
  const buildInfo = ts.getTsBuildInfoEmitOutputFilePath(config.options)
  if (!buildInfo || !fs.existsSync(buildInfo)) {
    return undefined
  }
  const builtAt = fs.statSync(buildInfo).mtimeMs

  for (const fileName of config.fileNames) {
    if (fileName.endsWith('.d.ts') || fileName.endsWith('.json')) {
      continue
    }
    const source = ts.createSourceFile(fileName, fs.readFileSync(fileName, 'utf8'), ts.ScriptTarget.Latest)
    for (const inlined of findInlinedFiles(source)) {
      if (fs.existsSync(inlined) && fs.statSync(inlined).mtimeMs > builtAt) {
        fs.unlinkSync(buildInfo)
        return inlined
      }
    }
  }
  return undefined
}

function main (args: string[]): void {
  let project = 'tsconfig.json'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-p' || args[i] === '--project') {
      project = args[++i]
    } else {
      console.error(`Usage: ts-inline-file-invalidate [-p <tsconfig.json>]\nUnknown argument: ${args[i]}`)
      process.exit(2)
    }
  }
  if (fs.existsSync(project) && fs.statSync(project).isDirectory()) {
    project = path.join(project, 'tsconfig.json')
  }

  const inlined = invalidate(project)
  if (inlined) {
    console.log(`${path.relative('.', inlined)} changed since the last build; dropped the build info to force a full rebuild`)
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
}
