'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, v) => cb(v));

contextBridge.exposeInMainWorld('opti', {
  init: () => ipcRenderer.invoke('app:init'),
  expand: (value, fresh, fromPicker) => ipcRenderer.invoke('trace:expand', { value, fresh, fromPicker }),
  cancel: () => ipcRenderer.invoke('trace:cancel'),
  detect: (value) => ipcRenderer.invoke('trace:detect', value),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  graph: () => ipcRenderer.invoke('trace:graph'),
  clear: () => ipcRenderer.invoke('trace:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  saveReport: (html, name, pdf) => ipcRenderer.invoke('report:save', { html, name, pdf }),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  onLog: on('trace:log'),
  onNode: on('trace:node'),
  onEdge: on('trace:edge'),
  onProgress: on('trace:progress'),
});
