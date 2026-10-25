import threading
from types import SimpleNamespace
import main


def test_budget_evicts_old_stopped_entries_and_preserves_current(tmp_path):
    jobs = {}
    for token, stopped in [('old', True), ('recent', True), ('active', False)]:
        folder = tmp_path / token
        folder.mkdir()
        (folder / 'segment.ts').write_bytes(b'x' * 8)
        stop = threading.Event()
        if stopped: stop.set()
        jobs[token] = {'folder': folder, 'stop': stop}
    state = SimpleNamespace(jobs=jobs)
    assert main.prune_media_cache(state, limit=16) == 16
    assert list(jobs) == ['recent', 'active']
    assert not (tmp_path / 'old').exists()
    assert main.prune_media_cache(state, limit=4) == 8
    assert list(jobs) == ['active']
    jobs['active']['stop'].set()
    assert main.prune_media_cache(state, limit=4) == 0
    assert jobs == {}
