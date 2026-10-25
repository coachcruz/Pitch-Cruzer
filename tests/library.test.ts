import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { completePreparation, getPreparation, preparedStems, savePreparation } from '../src/lib/library';
import { describe, expect, it, vi } from 'vitest';
import { buildLines } from '../src/lib/analysis';
import { buildLineId, deleteSong, exportSong, getSong, importSong, listBuildLines, listTakes, saveBuildLine, saveExistingSong, saveSong, saveTake, type StoredSong } from '../src/lib/library';

const song = (): StoredSong => {
  const notes = [{ start: 1, end: 2, midi: 60 }];
  return { id: crypto.randomUUID(), title: 'Test song', source: 'file', createdAt: Date.now(), stems: { lead: new Blob(['audio']) },
    analysis: { duration: 3, notes, lines: buildLines([{ text: 'hello', start: 1, end: 2 }], notes), sections: [], key: null, range: null, transcript: 'ok', separated: true } };
};

describe('durable song storage', () => {
  it('reuses paid tracks after saving without keeping a duplicate audio blob', async () => {
    const original = song();
    const id = crypto.randomUUID();
    await savePreparation({ id, sourceId: 'source', taskId: 'paid-task', stems: original.stems, createdAt: 1 });
    await saveSong(original);
    await completePreparation(id, original.id);
    const job = (await getPreparation(id))!;
    expect(job.taskId).toBe('paid-task');
    expect(job.stems).toBeUndefined();
    expect(await (await preparedStems(job))!.lead.text()).toBe('audio');
    await deleteSong(original.id);
    expect(await preparedStems(job)).toBeUndefined();
    expect((await getPreparation(id))!.taskId).toBe('paid-task');
  });
  it('round-trips repeats and kept builder recordings without overwriting the original', async () => {
    const original = song();
    await saveSong(original);
    await saveTake({ id: crypto.randomUUID(), songId: original.id, singer: 'Me', createdAt: 1, score: 85, label: 'twice',
      voice: new Blob(['voice']), sampleRate: 48000, segments: [{ start: 0, end: 3 }], repeats: 2, offsetSeconds: -0.1 });
    await saveBuildLine({ id: buildLineId(original.id, 1), songId: original.id, start: 1, end: 2, text: 'hello', score: 90,
      voice: new Blob(['kept']), songTimeAtStart: 0.5, createdAt: 1 });
    const backup = await exportSong(original);
    const restored = await importSong(backup);
    expect(restored.id).not.toBe(original.id);
    expect((await listTakes(restored.id))[0].repeats).toBe(2);
    expect(await (await listBuildLines(restored.id))[0].voice.text()).toBe('kept');
    await deleteSong(restored.id);
    expect(await listTakes(restored.id)).toEqual([]);
    expect(await listBuildLines(restored.id)).toEqual([]);
    expect(await getSong(original.id)).toBeDefined();
  });
  it('rejects a truncated backup before saving any part of it', async () => {
    const backup = await exportSong(song());
    await expect(importSong(backup.slice(0, backup.size - 1))).rejects.toThrow('truncated');
  });
  it('rejects HTML in imported identifiers', async () => {
    const bad = song(); bad.analysis.lines[0].id = '"><img src=x onerror=alert(1)>';
    await expect(importSong(await exportSong(bad))).rejects.toThrow('invalid');
  });
  it('does not report success if the transaction aborts after its put succeeds', async () => {
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    try { await expect(saveSong(song())).rejects.toThrow(); } finally { spy.mockRestore(); }
  });
  it('does not resurrect a deleted song when a background job finishes', async () => {
    const original = song(); await saveSong(original); await deleteSong(original.id);
    await saveExistingSong(original);
    expect(await getSong(original.id)).toBeUndefined();
  });
});
