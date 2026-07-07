import express from 'express';
import { listTodos, createTodo, updateTodo, deleteTodo } from '../lib/todos.mjs';

export const router = express.Router();

// GET /api/todos — all todos
router.get('/api/todos', (req, res) => {
  try {
    res.json({ todos: listTodos() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/todos { text, priority?, dueDate?, appId?, company? } — create
router.post('/api/todos', (req, res) => {
  try {
    const { text, priority, dueDate, appId, company } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'text is required' });
    res.json(createTodo({ text, priority, dueDate, appId, company }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/todos/:id — update text/done/priority/dueDate/order
router.patch('/api/todos/:id', (req, res) => {
  try {
    const updated = updateTodo(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Todo not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/todos/:id — remove
router.delete('/api/todos/:id', (req, res) => {
  try {
    const ok = deleteTodo(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Todo not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
