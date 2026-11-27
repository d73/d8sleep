"""Command-line control of an Eight Sleep Pod, using the app's -10..10 scale."""
import argparse
import math
import os
import subprocess
import sys
from eight import EightClient, ApiError
from server import ROOT, load_env

def level_value(value):
    try:
        level = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError('level must be an integer from -10 to 10') from exc
    if not -10 <= level <= 10:
        raise argparse.ArgumentTypeError('level must be an integer from -10 to 10')
    return level

SIDES = ('left', 'right', 'solo')
USAGE = ('pod [left|right|solo] {on,off,LEVEL,status} [ui]\n'
         '       pod ui')

def parse(argv):
    parser = argparse.ArgumentParser(prog='pod', usage=USAGE,
        description='Control an Eight Sleep Pod using the -10 to +10 app scale.',
        epilog='Use status to show all sides, or specify a side to show only that side. '
               'Use ui alone or anywhere in a Pod command to open the installed d8sleep app on Windows.')
    parser.add_argument('words', nargs='*', help=argparse.SUPPRESS)
    words = parser.parse_args(argv).words
    if words.count('ui') > 1:
        parser.error('ui may only be specified once')
    show_ui = 'ui' in words
    if show_ui:
        words.remove('ui')
        if not words:
            return None, None, None, True
    side = words.pop(0) if words and words[0] in SIDES else None
    if not words:
        parser.error('missing action: on, off, status, ui or a LEVEL from -10 to 10')
    if len(words) > 1:
        parser.error('too many arguments: expected [side] on | off | status | LEVEL')
    action = words[0]
    if action in ('on', 'off', 'status'):
        return side, action, None, show_ui
    try:
        return side, 'set', level_value(action), show_ui
    except argparse.ArgumentTypeError:
        parser.error(f'unknown action "{action}": use on, off, status, ui or a LEVEL from -10 to 10')

def format_level(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return '?'
    return f'{value / 10:g}'

def open_ui():
    if sys.platform != 'win32':
        print('pod ui requires an installed d8sleep app on Windows.', file=sys.stderr)
        return 1
    try:
        return subprocess.run([
            'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', str(ROOT / 'app-control.ps1'), 'ui',
        ]).returncode
    except OSError as exc:
        print(f'Could not open d8sleep: {exc}', file=sys.stderr)
        return 1


def run_pod_action(side_arg, action, level):
    load_env()
    if not os.getenv('EIGHT_EMAIL') or not os.getenv('EIGHT_PASSWORD'):
        print('Set EIGHT_EMAIL and EIGHT_PASSWORD in .env first.', file=sys.stderr)
        return 1
    try:
        client = EightClient(os.environ['EIGHT_EMAIL'], os.environ['EIGHT_PASSWORD'])
        sides = client.discover()
        if action == 'status':
            if side_arg and side_arg not in sides:
                print('Side is unavailable: ' + side_arg, file=sys.stderr)
                return 1
            for item in client.status():
                if side_arg and item['side'] != side_arg:
                    continue
                power = 'on' if item['power'] is True else 'off' if item['power'] is False else 'unknown'
                current = format_level(item.get('current'))
                target = format_level(item.get('target'))
                print(f"{item['side']}: {power} {current}/{target} (current/target)")
            return 0
        if side_arg:
            if side_arg not in sides:
                print('Side is unavailable: ' + side_arg, file=sys.stderr)
                return 1
            side = side_arg
        elif len(sides) == 1:
            side = next(iter(sides))
        else:
            print('Specify a side: ' + ', '.join(sorted(sides)), file=sys.stderr)
            return 1
        if action == 'set':
            print(f'{side}: turning on the Pod...', flush=True)
            client.set_power(side, True)
            print(f'{side}: turn-on request accepted.', flush=True)
            print(f'{side}: changing target level to {level:+d}...', flush=True)
            client.set_level(side, level * 10)
            print(f'{side}: target level {level:+d} request accepted.')
        else:
            client.set_power(side, action == 'on')
            print(f'{side}: {action}')
        return 0
    except ApiError as exc:
        print('Eight Sleep error: ' + str(exc), file=sys.stderr)
        return 1

def main(argv=None):
    side_arg, action, level, show_ui = parse(argv)
    action_result = run_pod_action(side_arg, action, level) if action else 0
    ui_result = open_ui() if show_ui else 0
    return action_result or ui_result


if __name__ == '__main__':
    sys.exit(main())
