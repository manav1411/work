#!/bin/sh
set -u
engine="$1"
main="$2"
mkdir -p /job/build
export TEXMFVAR=/tmp/texmf-var TEXMFCONFIG=/tmp/texmf-config
export openin_any=p openout_any=p TEXMFOUTPUT=/job/build
"$engine" --version > /job/build/engine.txt 2>&1
latexmk -version > /job/build/latexmk.txt 2>&1
[ "$engine" = pdflatex ] || exit 2
# No source-provided Perl configuration, shell escape or automatic dependency install.
latexmk -norc -pdf -outdir=/job/build -jobname=output \
  -synctex=1 -file-line-error -interaction=nonstopmode -halt-on-error \
  -latexoption=-no-shell-escape "./$main" > /job/build/compile.log 2>&1
status=$?
if [ "$status" -eq 0 ] && [ -f /job/build/output.pdf ]; then
  pdftotext -enc UTF-8 /job/build/output.pdf /job/build/text.txt 2>> /job/build/compile.log
  pdffonts /job/build/output.pdf > /job/build/fonts.txt 2>> /job/build/compile.log
fi
exit "$status"
