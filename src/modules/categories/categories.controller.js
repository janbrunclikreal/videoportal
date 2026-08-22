'use strict';

const categoriesService = require('./categories.service');
const { HttpError } = require('../../middleware/errorHandler');

function list(req, res, next) {
  try { res.json({ categories: categoriesService.list() }); } catch (err) { next(err); }
}

function create(req, res, next) {
  try {
    const { name, icon, color } = req.body || {};
    const id = categoriesService.create({ name, icon, color });
    res.status(201).json({ id });
  } catch (err) {
    if (err.status) return next(new HttpError(err.status, 'ERROR', err.message));
    next(err);
  }
}

function remove(req, res, next) {
  try {
    categoriesService.remove(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { list, create, remove };
