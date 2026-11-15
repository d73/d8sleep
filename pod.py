"""Command-line control of an Eight Sleep Pod, using the app's -10..10 scale."""
import argparse
import os
import sys
from eight import EightClient, ApiError
from server import load_env

def level_value(value):
    try:
        level = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError('level must be an integer from -10 to 10') from exc
    if not -10 <= level <= 10:
        raise argparse.ArgumentTypeError('level must be an integer from -10 to 10')
    return level

SIDES = ('left', 'right', 'solo')
USAGE = 'pod [left|right|solo] on | off | set LEVEL   (LEVEL is a whole number from -10 to +10)'

def parse(argv):
    parser = argparse.ArgumentParser(prog='pod', usage=USAGE,
        description='Control an Eight Sleep Pod using the -10 to +10 app scale. Every argument is positional: [side] action [level]. The side may be omitted only when the account has a single side.')
    parser.add_argument('words', nargs='*', help=argparse.SUPPRESS)
    words = parser.parse_args(argv).words
    side = words.pop(0) if words and words[0] in SIDES else None
    if not words:
        parser.error('missing action: on, off or set LEVEL')
    action = words.pop(0)
    if action in ('on', 'off'):
        if words:
            parser.error(f'"{action}" takes no level')
        return side, action, None
    if action == 'set':
        if len(words) != 1:
            parser.error('"set" needs exactly one level from -10 to 10')
        try:
            return side, action, level_value(words[0])
        except argparse.ArgumentTypeError as exc:
            parser.error(str(exc))
    parser.error(f'unknown action "{action}": use on, off or set LEVEL')

def main(argv=None):
    side_arg, action, level = parse(argv)
    load_env()
    if not os.getenv('EIGHT_EMAIL') or not os.getenv('EIGHT_PASSWORD'):
        print('Set EIGHT_EMAIL and EIGHT_PASSWORD in .env first.', file=sys.stderr)
        return 1
    try:
        client = EightClient(os.environ['EIGHT_EMAIL'], os.environ['EIGHT_PASSWORD'])
        sides = client.discover()
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
            client.set_level(side, level * 10)
            print(f'{side}: target level set to {level:+d}')
        else:
            client.set_power(side, action == 'on')
            print(f'{side}: {action}')
        return 0
    except ApiError as exc:
        print('Eight Sleep error: ' + str(exc), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
