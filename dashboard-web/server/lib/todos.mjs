import fs from 'fs';
import { randomBytes } from 'crypto';
import { TODOS_PATH } from '../config.mjs';

// ── To-do list ────────────────────────────────────────────────────────────────
// A single JSON sidecar under data/, same pattern as app-notes.json. Each todo:
//   { id, text, done, priority: 'low'|'med'|'high', createdAt, dueDate|null,
//     completedAt|null, order, source: 'manual'|'app', appId|null, company|null }
// `source:'app'` + appId/company link a todo back to a pipeline application (a
// to-do added from the job drawer); standalone todos leave those null.

const PRIORITIES = new Set(['low', 'med', 'high']);

function newTodoId() { return 'd_' + randomBytes(4).toString('hex'); }

function readTodos() {
  try {
    const raw = JSON.parse(fs.readFileSync(TODOS_PATH, 'utf8'));
    return Array.isArray(raw.todos) ? raw.todos : [];
  } catch { return []; }
}
function writeTodos(todos) {
  fs.writeFileSync(TODOS_PATH, JSON.stringify({ version: 1, todos: todos || [] }, null, 2) + '\n');
}

// All todos, newest-open-first is left to the client; return in stored order.
function listTodos() { return readTodos(); }

function createTodo({ text, notes = '', priority = 'med', dueDate = null, appId = null, company = null } = {}) {
  const clean = String(text == null ? '' : text).trim();
  if (!clean) throw new Error('Todo text is required');
  const todos = readTodos();
  const maxOrder = todos.reduce((m, t) => Math.max(m, t.order || 0), -1);
  const todo = {
    id: newTodoId(),
    text: clean,
    notes: String(notes == null ? '' : notes),
    done: false,
    priority: PRIORITIES.has(priority) ? priority : 'med',
    createdAt: new Date().toISOString(),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null,
    completedAt: null,
    order: maxOrder + 1,
    source: appId != null ? 'app' : 'manual',
    appId: appId != null ? appId : null,
    company: company || null,
  };
  todos.push(todo);
  writeTodos(todos);
  return todo;
}

// Patch one todo by id. Accepts text/done/priority/dueDate/order. Returns the
// updated todo, or null if not found.
function updateTodo(id, patch = {}) {
  const todos = readTodos();
  const idx = todos.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const t = todos[idx];
  if (patch.text !== undefined) {
    const clean = String(patch.text || '').trim();
    if (clean) t.text = clean;
  }
  if (patch.done !== undefined) {
    t.done = !!patch.done;
    t.completedAt = t.done ? new Date().toISOString() : null;
  }
  if (patch.notes !== undefined) t.notes = String(patch.notes == null ? '' : patch.notes);
  if (patch.priority !== undefined && PRIORITIES.has(patch.priority)) t.priority = patch.priority;
  if (patch.dueDate !== undefined) {
    t.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate) ? patch.dueDate : null;
  }
  if (patch.order !== undefined && Number.isFinite(patch.order)) t.order = patch.order;
  todos[idx] = t;
  writeTodos(todos);
  return t;
}

function deleteTodo(id) {
  const todos = readTodos();
  const next = todos.filter(t => t.id !== id);
  const removed = next.length !== todos.length;
  if (removed) writeTodos(next);
  return removed;
}

export { readTodos, writeTodos, listTodos, createTodo, updateTodo, deleteTodo, newTodoId };
