#!/usr/bin/perl
# ---------------------------------------------------------------------------
#  build-standalone.pl - bundle the dashboard into one self-contained .html
#
#  Reads index.html plus assets/css/styles.css and the four scripts, inlines
#  them, and writes Midea-Coverage-Dashboard.html next to this folder. The
#  result needs no folder structure at all: double-click it, email it, or drop
#  it on any web server.
#
#  Usage:  perl tools/build-standalone.pl [output-file]
# ---------------------------------------------------------------------------
use strict;
use warnings;

my $root = $0;
$root =~ s{[/\\]?tools[/\\]build-standalone\.pl$}{};
$root = '.' unless length $root;

my $out = shift @ARGV || "$root/Midea-Coverage-Dashboard.html";

sub slurp {
    my ($path) = @_;
    open my $fh, '<:raw', $path or die "Cannot read $path: $!\n";
    local $/;
    my $data = <$fh>;
    close $fh;
    return $data;
}

sub spew {
    my ($path, $data) = @_;
    open my $fh, '>:raw', $path or die "Cannot write $path: $!\n";
    print $fh $data;
    close $fh;
}

my $html = slurp("$root/index.html");
my $css  = slurp("$root/assets/css/styles.css");

die "styles.css contains </style - cannot inline\n" if $css =~ m{</style}i;

$html =~ s{<link rel="stylesheet" href="assets/css/styles\.css">\s*}{
    "<style>\n" . $css . "</style>\n"
}se or die "stylesheet link not found in index.html\n";

my @scripts = (
    'data/dataset.js',
    'data/ph-map.js',
    'assets/js/config.js',
    'assets/js/app.js',
);

for my $rel (@scripts) {
    my $code = slurp("$root/$rel");
    die "$rel contains </script - cannot inline\n" if $code =~ m{</script}i;
    $html =~ s{<script src="\Q$rel\E"></script>\s*}{
        "<script>\n" . $code . "\n</script>\n"
    }se or die "script tag for $rel not found in index.html\n";
}

my $banner = "<!--\n  Midea ProShop & HVAC Solution coverage dashboard - standalone build.\n"
           . "  Everything (styles, scripts, workbook data, province map) is inlined, so\n"
           . "  this one file works from any folder. Regenerate with:\n"
           . "      perl tools/build-standalone.pl\n"
           . "  Source files live beside it: index.html, assets/, data/.\n-->\n";

$html =~ s{<!DOCTYPE html>\n}{<!DOCTYPE html>\n$banner}s;

spew($out, $html);

my $kb = int((-s $out) / 1024 + 0.5);
printf "Wrote %s - %d KB\n", $out, $kb;
