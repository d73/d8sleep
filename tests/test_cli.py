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
    def status(self):
        return [{'side':'left', 'power':True, 'current':60, 'target':100},
                {'side':'right', 'power':False, 'current':None, 'target':-15}]

class CliTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.env = patch.dict(os.environ, {'EIGHT_EMAIL':'test', 'EIGHT_PASSWORD':'test'})
        self.env.start()
        self.factory = patch('pod.EightClient', return_value=self.client)
        self.factory.start()
        self.stdout = io.StringIO()
        self.output = contextlib.redirect_stdout(self.stdout); self.output.__enter__()
        self.errors = contextlib.redirect_stderr(io.StringIO()); self.errors.__enter__()
    def tearDown(self):
        self.errors.__exit__(None,None,None); self.output.__exit__(None,None,None)
        self.factory.stop(); self.env.stop()
    def test_set_maps_scale_and_side(self):
        self.assertEqual(pod.main(['left','-5']),0)
        self.assertEqual(self.client.calls,[('power','left',True),('level','left',-50)])
    def test_on_and_off(self):
        self.assertEqual(pod.main(['right','on']),0)
        self.assertEqual(pod.main(['left','off']),0)
        self.assertEqual(self.client.calls,[('power','right',True),('power','left',False)])
    def test_status_shows_all_sides_and_unavailable_values(self):
        self.assertEqual(pod.main(['status']), 0)
        self.assertEqual(self.stdout.getvalue(),
                         'left: on 6/10 (current/target)\nright: off ?/-1.5 (current/target)\n')
        self.assertEqual(self.client.calls, [])
    def test_status_can_filter_and_reject_unavailable_side(self):
        self.assertEqual(pod.main(['left', 'status']), 0)
        self.assertEqual(self.stdout.getvalue(), 'left: on 6/10 (current/target)\n')
        self.assertEqual(pod.main(['solo', 'status']), 1)
    def test_bounds_and_missing_side_do_not_write(self):
        with self.assertRaises(SystemExit): pod.main(['left','11'])
        self.assertEqual(pod.main(['0']),1)
        self.assertEqual(pod.main(['solo','off']),1)
        self.assertEqual(self.client.calls,[])
    def test_consistent_positional_grammar(self):
        for bad in (['left'], ['left','on','3'], ['left','1','2'], ['left','hot'], ['left','set','5'], ['--side','left','on']):
            with self.assertRaises(SystemExit): pod.main(bad)
        self.assertEqual(self.client.calls,[])
        self.assertEqual(pod.main(['left','+3']),0)
        self.assertEqual(self.client.calls,[('power','left',True),('level','left',30)])
    def test_power_failure_stops_level_change(self):
        self.client.set_power = lambda *_: (_ for _ in ()).throw(ApiError('unavailable'))
        self.assertEqual(pod.main(['left', '-5']), 1)
        self.assertEqual(self.client.calls, [])
    def test_level_failure_follows_successful_power_request(self):
        self.client.set_level = lambda *_: (_ for _ in ()).throw(ApiError('unavailable'))
        self.assertEqual(pod.main(['left', '-5']), 1)
        self.assertEqual(self.client.calls, [('power', 'left', True)])
    def test_api_errors_return_nonzero(self):
        self.client.set_power = lambda *_: (_ for _ in ()).throw(ApiError('unavailable'))
        self.assertEqual(pod.main(['left','off']),1)

    def test_ui_combines_with_a_pod_action_in_any_position(self):
        for args in (['ui', 'left', '-5'], ['left', 'ui', '-5'], ['left', '-5', 'ui']):
            with self.subTest(args=args), patch('pod.open_ui') as open_ui:
                self.client.calls.clear()

                def check_action_completed():
                    self.assertEqual(self.client.calls, [('power', 'left', True), ('level', 'left', -50)])
                    return 0

                open_ui.side_effect = check_action_completed
                self.assertEqual(pod.main(args), 0)
                open_ui.assert_called_once_with()

    def test_ui_only_skips_the_pod_and_invalid_commands_skip_ui(self):
        with patch('pod.load_env') as load_env, patch('pod.open_ui', return_value=0) as open_ui:
            self.assertEqual(pod.main(['ui']), 0)
            for args in (['left', 'ui'], ['ui', 'ui'], ['ui', 'left', '11']):
                with self.subTest(args=args), self.assertRaises(SystemExit):
                    pod.main(args)
            open_ui.assert_called_once_with()
            load_env.assert_not_called()

    def test_combined_command_reports_either_failure(self):
        with patch('pod.open_ui', return_value=2) as open_ui:
            self.assertEqual(pod.main(['status', 'ui']), 2)
            open_ui.assert_called_once_with()
        with patch('pod.open_ui', return_value=0) as open_ui:
            self.assertEqual(pod.main(['solo', 'status', 'ui']), 1)
            open_ui.assert_called_once_with()

if __name__ == '__main__': unittest.main()
