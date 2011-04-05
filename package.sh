#!/bin/sh
BRANCH=`git branch | egrep "\\* (.*)" | cut -c 3-`
DATE=`date +%Y%m%d%H%M`
TARGET_FILENAME="$DATE-$BRANCH.xpi"
GNUFILE=/Users/protz/bin/switchtognuutils

if [ -f "$GNUFILE" ]; then
  . "$GNUFILE";
fi;

upload() {
  echo "cd jonathan/files\nput kompose.xpi compose-in-a-tab-nightlies/$TARGET_FILENAME\n" | ftp xulforum@ftp.xulforum.org
}

if [ "$1" = "official" ]; then
  ./build.sh
  upload;
else
  ./build.sh
  upload;
  rm -f kompose.xpi;
fi
