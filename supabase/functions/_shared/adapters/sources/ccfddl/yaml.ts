// @deno-types="npm:yaml@2.9.1"
import { isAlias, isCollection, isNode, isPair, parseDocument } from "yaml";
import { ProcessingError } from "../../../application/ports.ts";
import { bytes } from "../../../domain/primitives.ts";

// YAML 1.2 core only. No custom tags, object constructors, merges or alias expansion.
// Check bytes and syntactic nesting before parsing; walk bounded AST before conversion.
export function safeYaml(payload: string, limit: number): unknown {
  if (bytes(payload) > limit) throw new ProcessingError("response_too_large");
  let nesting = 0;
  for (const line of payload.split("\n")) {
    if (/^ {41}/.test(line)) throw new ProcessingError("yaml_depth_limit");
    for (const character of line) {
      if (character === "[" || character === "{") nesting++;
      if (character === "]" || character === "}") nesting--;
      if (nesting > 20) throw new ProcessingError("yaml_depth_limit");
    }
  }
  try {
    const document = parseDocument(payload, {
      version: "1.2",
      schema: "core",
      merge: false,
      customTags: [],
      strict: true,
      uniqueKeys: true,
      stringKeys: true,
      prettyErrors: false,
      logLevel: "silent",
    });
    if (
      document.errors.length || document.warnings.length ||
      document.directives.yaml.version !== "1.2"
    ) {
      throw new ProcessingError("document_parse_failed");
    }
    let nodes = 0;
    const inspect = (node: unknown, depth: number): void => {
      if (++nodes > 4096 || depth > 20) throw new ProcessingError("yaml_resource_limit");
      if (isAlias(node) || isNode(node) && (node.anchor || node.tag)) {
        throw new ProcessingError("yaml_unsafe_feature");
      }
      if (isPair(node)) {
        const key = isNode(node.key) && "value" in node.key ? node.key.value : null;
        if (["__proto__", "prototype", "constructor", "<<"].includes(String(key))) {
          throw new ProcessingError("yaml_unsafe_feature");
        }
        inspect(node.key, depth + 1);
        inspect(node.value, depth + 1);
      } else if (isCollection(node)) {
        for (const item of node.items) inspect(item, depth + 1);
      }
    };
    inspect(document.contents, 0);
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ProcessingError("document_parse_failed");
  }
}
