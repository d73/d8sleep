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

def main(argv=None):
    parser = argparse.ArgumentParser(description='Control an Eight Sleep Pod using the -10 to +10 app scale.')
    parser.add_argument('--side', choices=['left', 'right', 'solo'], help='required if more than one side is available')
    subparsers = parser.add_subparsers(dest='action', required=True)
    subparsers.add_parser('on', help='turn the selected side on')
    subparsers.add_parser('off', help='turn the selected side off')
    subparsers.add_parser('set', help='set a level from -10 to +10').add_argument('level', type=level_value)
    args = parser.parse_args(argv)
    load_env()
    if not os.getenv('EIGHT_EMAIL') or not os.getenv('EIGHT_PASSWORD'):
        print('Set EIGHT_EMAIL and EIGHT_PASSWORD in .env first.', file=sys.stderr)
        return 1
    try:
        client = EightClient(os.environ['EIGHT_EMAIL'], os.environ['EIGHT_PASSWORD'])
        sides = client.discover()
        if args.side:
            if args.side not in sides:
                print('Side is unavailable: ' + args.side, file=sys.stderr)
                return 1
            side = args.side
        elif len(sides) == 1:
            side = next(iter(sides))
        else:
            print('Specify --side: ' + ', '.join(sorted(sides)), file=sys.stderr)
            return 1
        if args.action == 'set':
            client.set_level(side, args.level * 10)
            print(f'{side}: target level set to {args.level:+d}')
        else:
            client.set_power(side, args.action == 'on')
            print(f'{side}: {args.action}')
        return 0
    except ApiError as exc:
        print('Eight Sleep error: ' + str(exc), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
