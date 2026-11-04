#!/usr/bin/env perl
# ---------------------------------------------------------------------------
# serve.pl — tiny static file server for local preview (no dependencies)
#
#   perl tools/serve.pl            → http://127.0.0.1:8088/
#   perl tools/serve.pl 9000       → http://127.0.0.1:9000/
#
# Serves the folder that contains this script's parent directory (the site
# root). Binds to 127.0.0.1 only, so nothing is exposed to the network.
# The dashboard also works when index.html is opened directly from disk.
# ---------------------------------------------------------------------------
use strict;
use warnings;
use IO::Socket::INET;
use Cwd qw(abs_path);
use File::Basename qw(dirname);

my $root = abs_path(dirname(dirname(abs_path(__FILE__))));
my $port = $ARGV[0] || 8088;

my %MIME = (
  html => 'text/html; charset=utf-8',
  htm  => 'text/html; charset=utf-8',
  css  => 'text/css; charset=utf-8',
  js   => 'text/javascript; charset=utf-8',
  json => 'application/json; charset=utf-8',
  svg  => 'image/svg+xml',
  png  => 'image/png',
  jpg  => 'image/jpeg',
  jpeg => 'image/jpeg',
  ico  => 'image/x-icon',
  csv  => 'text/csv; charset=utf-8',
  pdf  => 'application/pdf',
  txt  => 'text/plain; charset=utf-8',
);

my $server = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1',
  LocalPort => $port,
  Proto     => 'tcp',
  Listen    => 32,
  ReuseAddr => 1,
) or die "Cannot listen on 127.0.0.1:$port — $!\n";

print "Serving $root\nhttp://127.0.0.1:$port/\n";
$| = 1;

while (my $client = $server->accept) {
  $client->autoflush(1);
  my $request = <$client>;
  unless (defined $request) { close $client; next; }

  my ($method, $target) = $request =~ m{^(\S+)\s+(\S+)};
  while (my $line = <$client>) { last if $line =~ /^\r?\n$/ }
  $method ||= 'GET';

  my $path = $target || '/';
  $path =~ s/[?#].*$//;
  $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
  $path = '/' if $path eq '';
  $path .= 'index.html' if $path =~ m{/$};

  my $relative = $path;
  $relative =~ s{^/+}{};
  my $full = "$root/$relative";

  my ($status, $type, $body) = ('404 Not Found', 'text/plain; charset=utf-8', "Not found: $path\n");

  if ($relative =~ /\.\./ || $full !~ m{^\Q$root\E}) {
    ($status, $body) = ('403 Forbidden', "Forbidden\n");
  } elsif ($method ne 'GET' && $method ne 'HEAD') {
    ($status, $body) = ('405 Method Not Allowed', "Method not allowed\n");
  } elsif (-f $full) {
    open my $fh, '<', $full or do {
      ($status, $body) = ('500 Internal Server Error', "Cannot read $path\n");
      goto RESPOND;
    };
    binmode $fh;
    local $/;
    $body = <$fh>;
    close $fh;
    $status = '200 OK';
    my ($ext) = $full =~ /\.([A-Za-z0-9]+)$/;
    $type = $ext ? ($MIME{lc $ext} || 'application/octet-stream') : 'application/octet-stream';
  }

  RESPOND:
  my $length = length($body);
  my $head = "HTTP/1.1 $status\r\n"
    . "Content-Type: $type\r\n"
    . "Content-Length: $length\r\n"
    . "Cache-Control: no-store\r\n"
    . "Connection: close\r\n\r\n";
  print $client $head;
  print $client $body unless $method eq 'HEAD';
  close $client;
}
