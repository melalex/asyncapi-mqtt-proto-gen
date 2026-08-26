'use strict';

/**
 * Small string-case helpers shared by every language backend.
 */

/** Lowercase, underscore-separated slug. Used for the default projectName (derived from info.title). */
function slugify(text) {
  return String(text)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'project';
}

/** UPPER_SNAKE_CASE, suitable for C/C++ header guards and macro names. */
function toUpperSnake(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

/** Validates/normalizes a string into a legal C++ identifier; throws if it can't be made into one. */
function assertValidCppIdentifier(name, context) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${context}: "${name}" is not a valid C++ identifier`);
  }
  return name;
}

module.exports = { slugify, toUpperSnake, assertValidCppIdentifier };
