#!/bin/sh
set -eu

# Install the immutable 8 March 2025 release, rather than an updated tlnet snapshot.
release=texlive2025-20250308.iso
release_url=https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/$release
release_sha512=1fd9a2234d086f50c832ab3ac8b83477bbc39b1138a3c4a2351244c1fd4b8bea6d1ac81d4a5b0cba95f2e82c00f0d9df5b33189eb222e4bae5dae1523ef0da0e
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
setup_dir=${WORK_TEXLIVE_SETUP_DIR:-$script_dir/.texlive-2025}
texlive_dir=/opt/work-texlive/2025
mode=${1:-install}

case "$(uname -m)" in
  aarch64) platform=aarch64-linux ;;
  x86_64) platform=x86_64-linux ;;
  *) printf '%s\n' 'This installer supports ARM64 and x86_64 Linux.' >&2; exit 1 ;;
esac

if [ "$mode" != download ] && [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run this installer with sudo to install the private compiler toolchain.' >&2
  exit 1
fi

if [ "$mode" != download ] && [ -f "$texlive_dir/work-release-sha512" ] && [ -x "$texlive_dir/bin/$platform/pdflatex" ]; then
  "$texlive_dir/bin/$platform/pdflatex" --version | head -1 | grep -F '1.40.27 (TeX Live 2025)'
  exit 0
fi

mkdir -p "$setup_dir"
if [ ! -f "$setup_dir/release-verified" ] || [ ! -f "$setup_dir/$release" ]; then
  rm -f -- "$setup_dir/release-verified"
  curl --fail --location --retry 5 --continue-at - "$release_url" --output "$setup_dir/$release"
  printf '%s  %s\n' "$release_sha512" "$release" > "$setup_dir/release.sha512"
  (cd "$setup_dir" && sha512sum -c release.sha512)
  touch "$setup_dir/release-verified"
fi
[ "$mode" != download ] || exit 0

repository_dir=$setup_dir/repository
mkdir -p "$repository_dir"
# Read package archives directly; copying the entire ISO wastes disk and I/O.
mount -o loop,ro "$setup_dir/$release" "$repository_dir"
trap 'umount "$repository_dir" || true' EXIT
trap 'exit 130' INT TERM

cat > "$setup_dir/install.profile" <<PROFILE
selected_scheme scheme-full
binary_$platform 1
TEXDIR $texlive_dir
TEXMFLOCAL /opt/work-texlive/texmf-local
TEXMFSYSCONFIG $texlive_dir/texmf-config
TEXMFSYSVAR $texlive_dir/texmf-var
TEXMFCONFIG ~/.texlive2025/texmf-config
TEXMFVAR ~/.texlive2025/texmf-var
TEXMFHOME ~/texmf
instopt_adjustpath 0
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
tlpdbopt_autobackup 0
PROFILE

perl "$repository_dir/install-tl" -no-interaction -profile "$setup_dir/install.profile" -repository "$repository_dir"
"$texlive_dir/bin/$platform/pdflatex" --version | head -1 | grep -F '1.40.27 (TeX Live 2025)'
printf '%s\n' "$release_url" > "$texlive_dir/work-release-url"
printf '%s\n' "$release_sha512" > "$texlive_dir/work-release-sha512"
umount "$repository_dir"
trap - EXIT INT TERM
# Remove only the verified installer download after installation completes.
rm -- "$setup_dir/$release"
printf '%s\n' 'Pinned TeX Live installed. Activate the compiler with install-pi.sh.'
