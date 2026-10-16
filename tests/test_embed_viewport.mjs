import assert from "node:assert/strict";
import test from "node:test";
import { hostViewport } from "../embed-viewport.mjs";

test("embedded sidebar accepts viewport geometry only from its own host", () => {
    const host = {}, origin = "https://host.example";
    const event = { source: host, origin, data: { type: "pdf-editor:viewport", top: 420, height: 650 } };
    assert.deepEqual(hostViewport(event, host, origin), { top: 420, height: 650 });
    assert.equal(hostViewport({ ...event, source: {} }, host, origin), null);
    assert.equal(hostViewport({ ...event, origin: "https://other.example" }, host, origin), null);
    for (const data of [{ ...event.data, top: -1 }, { ...event.data, top: NaN }, { ...event.data, top: "420" },
        { ...event.data, top: 100001 }, { ...event.data, height: 0 }, { ...event.data, height: Infinity },
        { ...event.data, height: 10001 }, { ...event.data, type: "pdf-editor:edit" }, null])
        assert.equal(hostViewport({ ...event, data }, host, origin), null);
});
