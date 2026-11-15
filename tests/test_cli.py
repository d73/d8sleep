import contextlib
import io
import os
import unittest
from unittest.mock import patch
import pod
from eight import ApiError

class FakeClient:
    def __init__(self, *args):
        self.calls = []
    def discover(self): return {'left':'id1', 'right':'id2'}
    def set_level(self, side, level): self.calls.append(('level',side,level))
    def set_power(self, side, on): self.calls.append(('power',side,on))

class CliTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.env = patch.dict(os.environ, {'EIGHT_EMAIL':'test', 'EIGHT_PASSWORD':'test'})
        self.env.start()
        self.factory = patch('pod.EightClient', return_value=self.client)
        self.factory.start()
        self.output = contextlib.redirect_stdout(io.StringIO()); self.output.__enter__()
        self.errors = contextlib.redirect_stderr(io.StringIO()); self.errors.__enter__()
    def tearDown(self):
        self.errors.__exit__(None,None,None); self.output.__exit__(None,None,None)
        self.factory.stop(); self.env.stop()
    def test_set_maps_scale_and_side(self):
        self.assertEqual(pod.main(['left','set','-5']),0)
        self.assertEqual(self.client.calls,[('level','left',-50)])
    def test_on_and_off(self):
        self.assertEqual(pod.main(['right','on']),0)
        self.assertEqual(pod.main(['left','off']),0)
        self.assertEqual(self.client.calls,[('power','right',True),('power','left',False)])
    def test_bounds_and_missing_side_do_not_write(self):
        with self.assertRaises(SystemExit): pod.main(['left','set','11'])
        self.assertEqual(pod.main(['set','0']),1)
        self.assertEqual(pod.main(['solo','off']),1)
        self.assertEqual(self.client.calls,[])
    def test_consistent_positional_grammar(self):
        for bad in (['left'], ['left','on','3'], ['left','set'], ['left','set','1','2'], ['left','hot'], ['--side','left','on']):
            with self.assertRaises(SystemExit): pod.main(bad)
        self.assertEqual(self.client.calls,[])
        self.assertEqual(pod.main(['left','set','+3']),0)
        self.assertEqual(self.client.calls,[('level','left',30)])
    def test_api_errors_return_nonzero(self):
        self.client.set_power = lambda *_: (_ for _ in ()).throw(ApiError('unavailable'))
        self.assertEqual(pod.main(['left','off']),1)

if __name__ == '__main__': unittest.main()
