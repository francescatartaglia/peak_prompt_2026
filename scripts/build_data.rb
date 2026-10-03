#!/usr/bin/env ruby
# frozen_string_literal: true

require "rexml/document"
require "time"
require "json"
require "shellwords"

ROOT = File.expand_path("..", __dir__)
GPX = File.join(ROOT, "assets/peak_prompt.gpx")
OUT = File.join(ROOT, "data/timeline.json")
MEDIA_GLOB = File.join(ROOT, "assets/media/**/*.{JPG,jpeg,JPEG,jpg,MOV,mov,MP4,mp4,PNG,png,HEIC,heic,m4a,M4A,mp3,MP3,wav,WAV}")

def mdls_raw(path, key)
  out = `mdls -name #{key} -raw #{Shellwords.escape(path)}`.strip
  return nil if out.empty? || out == "(null)"
  out
end

def parse_mdls_time(str)
  Time.strptime(str, "%Y-%m-%d %H:%M:%S %z").utc
rescue ArgumentError
  begin
    Time.parse(str).utc
  rescue StandardError
    nil
  end
end

def mdls_creation(path)
  raw = mdls_raw(path, "kMDItemContentCreationDate")
  raw && parse_mdls_time(raw)
end

def mdls_duration(path)
  raw = mdls_raw(path, "kMDItemDurationSeconds")
  raw&.to_f
end

# Voice memos often keep the true capture time as an ISO string in the file body,
# while Finder creation dates reflect the export/copy moment.
def embedded_iso_time(path)
  data = File.binread(path)
  match = data.force_encoding("ASCII-8BIT").match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
  return nil unless match
  Time.parse("#{match[1]}Z").utc
rescue StandardError
  nil
end

def asset_time(path, kind)
  if kind == "audio"
    embedded = embedded_iso_time(path)
    return embedded if embedded
  end
  mdls_creation(path)
end

doc = REXML::Document.new(File.read(GPX))
name = doc.elements["//metadata/name"]&.text || doc.elements["//trk/name"]&.text || "Track"
desc = doc.elements["//trk/desc"]&.text || doc.elements["//trk/cmt"]&.text

track = []
doc.elements.each("//trkpt") do |pt|
  t = pt.elements["time"]&.text
  next unless t
  track << {
    lat: pt.attributes["lat"].to_f,
    lon: pt.attributes["lon"].to_f,
    ele: pt.elements["ele"]&.text&.to_f,
    time: Time.parse(t).utc.iso8601(3),
    t: Time.parse(t).utc
  }
end

raise "No track points" if track.empty?

t0 = track.first[:t]
t1 = track.last[:t]
span = (t1 - t0).to_f
span = 1.0 if span <= 0

eles = track.map { |p| p[:ele] }.compact
ele_min = eles.min
ele_max = eles.max

track_render = track.map do |p|
  progress = ((p[:t] - t0) / span)
  {
    lat: p[:lat],
    lon: p[:lon],
    ele: p[:ele],
    time: p[:time],
    progress: progress.round(5)
  }
end

assets = Dir.glob(MEDIA_GLOB).sort.map do |path|
  ext = File.extname(path).downcase
  kind = %w[.mov .mp4 .m4v].include?(ext) ? "video" : %w[.m4a .mp3 .wav .aac].include?(ext) ? "audio" : "image"
  ts = asset_time(path, kind)
  unless ts
    warn "skip (no time): #{path}"
    next
  end

  best_i = 0
  best_d = Float::INFINITY
  track.each_with_index do |p, i|
    d = (p[:t] - ts).abs
    if d < best_d
      best_d = d
      best_i = i
    end
  end
  nearest = track[best_i]
  rel = path.sub("#{ROOT}/", "")
  source = rel.split("/")[2] # camera | phone | audio
  progress = ((ts - t0) / span)
  progress = -0.05 if progress < -0.05
  progress = 1.05 if progress > 1.05

  {
    id: File.basename(path),
    path: rel,
    source: source,
    kind: kind,
    time: ts.iso8601,
    duration: %w[video audio].include?(kind) ? mdls_duration(path) : nil,
    progress: progress.round(5),
    onTrack: ts >= t0 && ts <= t1,
    match: {
      time: nearest[:time],
      lat: nearest[:lat],
      lon: nearest[:lon],
      ele: nearest[:ele],
      deltaSeconds: best_d.round(1),
      index: best_i
    }
  }
end.compact.sort_by { |a| a[:time] }

payload = {
  title: name.sub(/\AWikiloc - /, ""),
  description: desc,
  gpx: GPX.sub("#{ROOT}/", ""),
  start: t0.iso8601(3),
  end: t1.iso8601(3),
  durationMinutes: ((t1 - t0) / 60.0).round(1),
  trackPointCount: track.size,
  elevation: {
    min: ele_min,
    max: ele_max,
    gain: (ele_max - ele_min).round(1)
  },
  track: track_render,
  assets: assets
}

File.write(OUT, JSON.pretty_generate(payload))
puts "Wrote #{OUT}"
puts "track points: #{track.size}"
puts "elevation: #{ele_min.round}–#{ele_max.round} m"
counts = assets.group_by { |a| a[:kind] }.transform_values(&:size)
puts "assets: #{assets.size} #{counts.inspect}"
puts "onTrack=#{assets.count { |a| a[:onTrack] }} off=#{assets.count { |a| !a[:onTrack] }}"
