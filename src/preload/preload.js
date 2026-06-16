'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opti', {
  init: () => ipcRenderer.invoke('app:init'),
  expand: (value, fresh) => ipcRenderer.invoke('trace:expand', { value, fresh }),
  detect: (value) => ipcRenderer.invoke('trace:detect', value),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  graph: () => ipcRenderer.invoke('trace:graph'),
  clear: () => ipcRenderer.invoke('trace:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  saveReport: (html, name) => ipcRenderer.invoke('report:save', { html, name }),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  onLog: (cb) => ipcRenderer.on('trace:log', (_e, t) => cb(t)),
  onNode: (cb) => ipcRenderer.on('trace:node', (_e, n) => cb(n)),
  onEdge: (cb) => ipcRenderer.on('trace:edge', (_e, e) => cb(e)),
  onProgress: (cb) => ipcRenderer.on('trace:progress', (_e, p) => cb(p)),
});
