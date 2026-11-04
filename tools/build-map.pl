#!/usr/bin/env perl
# ---------------------------------------------------------------------------
# build-map.pl — regenerates data/ph-map.js (the Philippines province map)
#
# Source : macoymejia/geojsonph  Province/Provinces.json  (PSA province borders)
# Output : window.PH_MAP = { viewBox, width, height, provinces:[{key,name,d}] }
#
# Geometry is projected (equirectangular, latitude corrected), simplified with
# Douglas–Peucker, rounded to 1 decimal and emitted as flat SVG path strings so
# the dashboard can draw a choropleth with no runtime map library.
#
# Usage (from the project root):
#     perl tools/build-map.pl                 # downloads the source once
#     perl tools/build-map.pl source.json     # reuse an existing download
# ---------------------------------------------------------------------------
use strict;
use warnings;
use JSON::PP;

my $SRC_URL = 'https://raw.githubusercontent.com/macoymejia/geojsonph/master/Province/Provinces.json';
my $OUT     = 'data/ph-map.js';
my $CACHE   = 'tools/.provinces.cache.json';

# --- projection window (Philippines extent, with a little padding) ---------
my ($LON0, $LAT1) = (116.80, 21.10);
my $COS = cos(13.0 * 3.14159265358979 / 180);   # mid-latitude correction
my $H   = 760;                                   # drawing height in px
my $PAD = 6;

# --- simplification -------------------------------------------------------
my $EPS      = 0.0035;   # Douglas–Peucker tolerance, in degrees (~0.4 km)
my $MIN_AREA = 0.00025;  # drop islets smaller than this (square degrees)

sub decode_source {
  my ($path) = @_;
  open my $fh, '<', $path or die "cannot read $path: $!";
  binmode $fh;
  local $/;
  my $raw = <$fh>;
  close $fh;
  return decode_json($raw);
}

my $source = shift @ARGV;
unless ($source) {
  if (-e $CACHE) {
    $source = $CACHE;
  } else {
    print "Downloading province geometry (16 MB, one time)...\n";
    system('curl', '-sSL', '--max-time', '280', '-o', $CACHE, $SRC_URL) == 0
      or die "download failed (curl exit " . ($? >> 8) . ")\n";
    die "download produced no data\n" unless -s $CACHE;
    $source = $CACHE;
  }
}

my $geo = decode_source($source);
die "not a FeatureCollection\n" unless ref $geo->{features} eq 'ARRAY';

# --- province names: map old shapefile labels onto current data keys -------
my %RENAME = (
  'METROPOLITAN MANILA' => 'METRO MANILA',
  'COMPOSTELA VALLEY'   => 'DAVAO DE ORO',
  'NORTH COTABATO'      => 'COTABATO',
  'TAWITAWI'            => 'TAWI-TAWI',
  'MAGUINDANAO'         => 'MAGUINDANAO DEL SUR',
);
my %DROP = map { $_ => 1 } ('SHARIFF KABUNSUAN');   # defunct, overlaps Maguindanao

sub ring_area {
  my ($r) = @_;
  my ($a, $n) = (0, scalar @$r);
  for my $i (0 .. $n - 2) {
    $a += $r->[$i][0] * $r->[$i + 1][1] - $r->[$i + 1][0] * $r->[$i][1];
  }
  return abs($a) / 2;
}

sub dp_simplify {
  my ($pts, $eps) = @_;
  my $n = scalar @$pts;
  return $pts if $n < 3;
  my @keep = (0) x $n;
  $keep[0] = $keep[$n - 1] = 1;
  my @stack = ([0, $n - 1]);
  while (@stack) {
    my ($a, $b) = @{ pop @stack };
    next if $b <= $a + 1;
    my ($ax, $ay) = @{ $pts->[$a] };
    my ($bx, $by) = @{ $pts->[$b] };
    my ($dx, $dy) = ($bx - $ax, $by - $ay);
    my $len2 = $dx * $dx + $dy * $dy;
    my ($idx, $best) = (-1, 0);
    for my $i ($a + 1 .. $b - 1) {
      my ($px, $py) = @{ $pts->[$i] };
      my ($t) = $len2 ? (($px - $ax) * $dx + ($py - $ay) * $dy) / $len2 : 0;
      $t = 0 if $t < 0;
      $t = 1 if $t > 1;
      my ($cx, $cy) = ($ax + $t * $dx, $ay + $t * $dy);
      my $d = ($px - $cx) ** 2 + ($py - $cy) ** 2;
      if ($d > $best) { ($best, $idx) = ($d, $i) }
    }
    if ($idx > 0 && $best > $eps * $eps) {
      $keep[$idx] = 1;
      push @stack, [$a, $idx], [$idx, $b];
    }
  }
  my @out = map { $pts->[$_] } grep { $keep[$_] } 0 .. $n - 1;
  return \@out;
}

sub fmt { my $v = shift; my $s = sprintf('%.1f', $v); $s =~ s/\.0$//; return $s }

my (@shapes, %skipped);
for my $ft (@{ $geo->{features} }) {
  my $p    = $ft->{properties} || {};
  my $name = uc($p->{PROVINCE} || $p->{NAME_1} || '');
  $name =~ s/[^A-Z ]//g;
  $name =~ s/^\s+|\s+$//g;
  next unless length $name;
  next if $DROP{$name};
  my $key = $RENAME{$name} || $name;
  my $g = $ft->{geometry} or next;
  my @polys = $g->{type} eq 'Polygon' ? ($g->{coordinates}) : @{ $g->{coordinates} || [] };

  my @parts;
  for my $poly (@polys) {
    for my $ring (@$poly) {
      next if ring_area($ring) < $MIN_AREA;
      # project
      my @pts = map { [ ($_->[0] - $LON0) * $COS, ($LAT1 - $_->[1]) ] } @$ring;
      my $simp = dp_simplify(\@pts, $EPS);
      next if @$simp < 3;
      my @d;
      for my $i (0 .. $#$simp) {
        push @d, ($i ? 'L' : 'M') . fmt($simp->[$i][0] * 46) . ',' . fmt($simp->[$i][1] * 46);
      }
      push @parts, join('', @d) . 'Z';
    }
  }
  next unless @parts;
  push @shapes, { key => $key, name => title_case($key), d => join('', @parts) };
}

sub title_case {
  my $s = lc shift;
  $s =~ s/\b([a-z])/uc $1/ge;
  $s =~ s/\bDe\b/de/g;
  $s =~ s/\bDel\b/del/g;
  $s =~ s/\bMetro Manila\b/Metro Manila/;
  return $s;
}

die "no shapes produced\n" unless @shapes;
@shapes = sort { $a->{key} cmp $b->{key} } @shapes;

my $json = JSON::PP->new->canonical->encode(\@shapes);
open my $ofh, '>', $OUT or die "cannot write $OUT: $!";
print $ofh "/* Philippines province geometry for the dashboard map.\n"
  . " * Generated by tools/build-map.pl — do not edit by hand.\n"
  . " * Source: geojsonph Province/Provinces.json (PSA boundaries), simplified.\n"
  . " */\n";
print $ofh "window.PH_MAP={\"viewBox\":\"0 0 460 772\",\"width\":460,\"height\":772,\"provinces\":$json};\n";
close $ofh;

my $bytes = -s $OUT;
printf "Wrote %s — %d provinces, %.0f KB\n", $OUT, scalar @shapes, $bytes / 1024;
