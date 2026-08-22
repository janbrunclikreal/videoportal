'use strict';

const express = require('express');
const controller = require('./auth.controller');

const router = express.Router();

router.post('/login', controller.login);
router.post('/register', controller.register);
router.post('/logout', controller.logout);
// GET fallback kvůli jednoduchým `<a href="/logout">` odkazům v šablonách.
router.get('/logout', controller.logout);

module.exports = router;
